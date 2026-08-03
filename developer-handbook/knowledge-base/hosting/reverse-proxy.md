---
title: 'Reverse Proxy'
description: 'Why a proxy sits in front of your application server — what it takes off your hands, forwarded headers, trust configuration and the failure modes it introduces.'
---

# Reverse Proxy

## Introduction

A reverse proxy sits between clients and your application servers. Clients
connect to it; it forwards requests onward and returns the responses.

**Forward vs reverse** is the naming that confuses people:

- A **forward proxy** acts for the _client_ — a corporate proxy, a VPN. The
  server does not know who the real client is.
- A **reverse proxy** acts for the _server_ — nginx, a load balancer, a CDN. The
  client does not know which backend served it.

```text
                    ┌─────────────┐    ┌── app:3000
Client ──HTTPS──▶   │   Proxy     │────┼── app:3001
                    │  (nginx)    │    └── app:3002
                    └─────────────┘
                    TLS, static files, caching, rate limits
```

**Why it is the default architecture.** Application servers are good at running
your code and poor at everything else. Node, Django, Rails and PHP-FPM all
handle TLS, static files, slow clients and concurrent connections worse than a
purpose-built proxy — and a proxy is one process to configure rather than a
concern threaded through your application.

---

## What It Takes Off Your Hands

**TLS termination.** The proxy holds the certificate and handles the handshake;
your application speaks plain HTTP on localhost. One place to renew, one place
to configure ciphers. See [SSL/TLS](/knowledge-base/hosting/ssl-tls).

**Static files.** Nginx serves a file with a kernel-level `sendfile` call. Any
application runtime doing the same work is orders of magnitude slower and
occupies a request handler while doing it.

**Load balancing.** Distribute across several backends, with health checks that
remove a failing one from rotation.

**Slow client buffering.** This one is underappreciated. A client on a poor
mobile connection takes seconds to receive a response. Without a proxy, that
ties up an application worker for the whole duration — with a fixed worker pool
(PHP-FPM, Gunicorn), a few hundred slow clients exhaust it entirely. The proxy
accepts the response quickly and drip-feeds the client, freeing the worker
immediately.

**Compression, caching and rate limiting** — all applied before your application
sees the request, so shed load never costs you anything.

**Zero-downtime deploys.** Start the new version, add it to the upstream, drain
the old one. The proxy holds connections while backends restart underneath.

**A single entry point.** Several services on one domain:

```text
example.com/          → marketing site
example.com/app       → the SPA
example.com/api       → the API service
```

Everything is same-origin, which removes [CORS](/knowledge-base/security/cors)
entirely.

---

## Forwarded Headers

The part that causes real bugs, because the proxy hides the client from your
application.

Once a proxy is in front, your application sees:

- **The proxy's IP** as the client address — `127.0.0.1` for every visitor.
- **HTTP** as the protocol, even though the client used HTTPS.
- **The proxy's port and hostname**, not the public ones.

The proxy communicates the real values in headers:

```http
X-Forwarded-For: 203.0.113.42, 198.51.100.7
X-Forwarded-Proto: https
X-Forwarded-Host: example.com
X-Real-IP: 203.0.113.42
```

There is also the standardised `Forwarded` header (RFC 7239), which combines
them — better designed, less widely used.

**`X-Forwarded-For` is a list.** Each proxy appends the address it received the
request from, so the leftmost entry is the original client and the rest are
intermediate proxies.

### Trust configuration

**This is where it goes wrong**, and the mistake has security consequences in
both directions.

```ts
// Express — trust exactly the proxies you have
app.set('trust proxy', 1); // one proxy in front
```

```python
# FastAPI / Starlette
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["10.0.0.1"])
```

```php
// Laravel — bootstrap/app.php
$middleware->trustProxies(at: ['10.0.0.1'], headers: Request::HEADER_X_FORWARDED_ALL);
```

**If you do not trust the headers**, `req.ip` is the proxy, so rate limiting
counts every user as one client, logs are useless, and geolocation fails.
`req.protocol` reports HTTP, so `secure` cookies may not be set and
HTTPS-redirect logic loops.

**If you trust them unconditionally**, a client can send their own
`X-Forwarded-For` and your application believes it — spoofing their IP to evade
rate limits, IP allowlists and audit logs.

**The correct setting is the number of proxies you actually have**, or their
specific addresses. `trust proxy: true` in Express trusts any hop, which is the
insecure form. Count the hops: a CDN in front of a load balancer in front of
nginx is three.

---

## Choosing One

|                  | **Nginx**       | **Caddy**          | **Traefik**       | **HAProxy**    | **Cloud LB**    |
| ---------------- | --------------- | ------------------ | ----------------- | -------------- | --------------- |
| Automatic TLS    | Via certbot     | **Built in**       | Built in          | External       | Managed         |
| Config style     | Files           | Minimal files      | Labels/discovery  | Files          | Console/IaC     |
| Container-native | No              | Partly             | **Yes**           | No             | Yes             |
| Load balancing   | Good            | Good               | Good              | **Excellent**  | Managed         |
| Static files     | **Excellent**   | Excellent          | Limited           | No             | No              |
| Best for         | General purpose | Simple deployments | Docker/Kubernetes | High-volume LB | Cloud platforms |

**Caddy is the best default for a single server** — automatic HTTPS with no
certbot, no cron, no renewal hook:

```caddy
example.com {
  reverse_proxy localhost:3000
  encode gzip zstd
  file_server /assets/* {
    root /var/www
  }
}
```

**Nginx** when you want the largest body of documentation and the widest module
ecosystem. See [Nginx](/knowledge-base/hosting/nginx).

**Traefik** in Docker or Kubernetes, where it discovers backends from labels
rather than needing a config change per service.

**A managed load balancer** (ALB, Cloud Load Balancing) when you are already on
a cloud platform — certificates, health checks and scaling are handled, at the
cost of less control and per-hour billing.

---

## Configuration That Matters

```nginx
location / {
    proxy_pass http://app;
    proxy_http_version 1.1;              # 1.0 by default — breaks keepalive

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Upgrade    $http_upgrade;   # WebSockets
    proxy_set_header Connection "upgrade";

    proxy_connect_timeout 5s;            # fail fast if the backend is down
    proxy_read_timeout   60s;            # longer than your slowest endpoint
    proxy_next_upstream  error timeout;  # retry another backend
}
```

**Timeouts need thought.** `proxy_connect_timeout` should be short — a backend
that is not accepting connections should fail immediately. `proxy_read_timeout`
must exceed your slowest legitimate request, or long-running endpoints return
504 at the proxy while the backend is still working.

**Buffering must be disabled for streaming.** Nginx buffers proxied responses by
default, which breaks Server-Sent Events and streamed LLM output — nothing
arrives until the buffer fills. See
[Server-Sent Events](/knowledge-base/apis/server-sent-events).

**WebSockets need the upgrade headers** and HTTP/1.1, plus a long enough
`proxy_read_timeout` that idle connections are not cut. See
[WebSockets](/knowledge-base/apis/websockets).

**Health checks** determine whether a backend receives traffic. Distinguish
them:

- **Liveness** — is the process alive? Restart if not.
- **Readiness** — can it serve traffic? A booting instance is alive but not
  ready, and routing to it produces errors during every deploy.

---

## The Failure Modes It Introduces

A proxy solves problems and adds its own. Worth knowing before debugging one at
3 a.m.

**Another hop to fail.** A 502 means the backend did not answer; a 504 means it
was too slow. Neither is the proxy's fault, and both surface as the proxy's
error page — which is why people debug the wrong layer.

**Header size limits.** Proxies cap header size, often lower than application
servers. A large cookie or a long `Authorization` header produces a `431` or
`400` that does not reproduce when hitting the backend directly.

**Body size limits.** Nginx defaults to 1 MB, which is the cause of most
unexplained `413` errors on upload endpoints.

**Timeout mismatches.** If the proxy times out at 60 s and the backend at 120 s,
the client sees a 504 while the backend continues working — and the work may
complete invisibly.

**Buffering changing streaming behaviour**, as above.

**Losing the client IP**, as above.

**Caching the wrong thing.** A cached authenticated response served to another
user is a genuine data leak. Never cache without keying on the user, and mark
user-specific responses `Cache-Control: private`.

---

## Debugging

The most useful technique: **bypass the proxy and compare.**

```bash
curl -i https://example.com/api/orders          # through the proxy
curl -i http://127.0.0.1:3000/api/orders        # directly to the backend
```

If the backend answers correctly and the proxy does not, the problem is proxy
configuration. If both fail, it is the application.

| Symptom                           | Cause and fix                                                  |
| --------------------------------- | -------------------------------------------------------------- |
| 502 Bad Gateway                   | Backend down, wrong port, or crashed. Check the app first.     |
| 504 Gateway Timeout               | Backend slower than `proxy_read_timeout`.                      |
| 413 Payload Too Large             | Proxy body limit below the application's.                      |
| App logs 127.0.0.1 for everyone   | Forwarded headers missing, or not trusted.                     |
| Redirect loop to HTTPS            | App does not see `X-Forwarded-Proto`, so it redirects forever. |
| `secure` cookies not set          | Same cause — the app thinks the request is HTTP.               |
| Streaming buffered until complete | `proxy_buffering` on.                                          |
| WebSocket fails to connect        | Missing `Upgrade`/`Connection` headers or HTTP/1.1.            |
| Users see each other's data       | A cached authenticated response.                               |
| Works directly, 404 through proxy | Path rewriting — the `proxy_pass` trailing slash.              |

The **HTTPS redirect loop** is worth recognising: the proxy terminates TLS and
forwards HTTP; the application sees HTTP and redirects to HTTPS; the proxy
forwards that as HTTP again. The fix is trusting `X-Forwarded-Proto`, not
disabling the redirect.

---

## Do's and Don'ts

### Do

- Put a proxy in front of any application server exposed to the internet.
- Set all four forwarded headers.
- Configure the application to trust exactly the number of proxies you have.
- Set `proxy_connect_timeout` short and `proxy_read_timeout` longer than your
  slowest endpoint.
- Disable buffering for streaming endpoints.
- Serve static files from the proxy.
- Separate liveness and readiness health checks.
- Compare proxy and direct responses when debugging.

### Don't

- Don't trust forwarded headers unconditionally — that lets clients spoof their
  IP.
- Don't leave the body size limit at its default on upload routes.
- Don't let proxy and backend timeouts disagree.
- Don't cache authenticated responses without keying on the user.
- Don't terminate TLS and then cross a public network in plain HTTP.
- Don't use IP hashing as a substitute for a shared session store.
- Don't debug the proxy before checking whether the backend is running.

---

## FAQ

**Do I need one if my app can serve HTTPS itself?**
Usually yes. Certificate renewal, static files, slow-client buffering, rate
limiting and zero-downtime restarts are all better handled outside your
application.

**Nginx, Caddy or Traefik?**
Caddy for a simple server — automatic HTTPS is a real saving. Traefik for
containers. Nginx when you want the widest documentation and module support.

**Is a CDN a reverse proxy?**
Yes, a geographically distributed one. The same forwarded-header and caching
concerns apply. See [CDN](/knowledge-base/hosting/cdn).

**How do I do zero-downtime deploys?**
Start the new version, wait for its readiness check, add it to the upstream,
remove the old one, and let connections drain.

**What about API gateways?**
A gateway adds authentication, rate limiting per key, request transformation and
usage metering on top of proxying. Worth it for a public API; overkill
internally.

**Does a proxy add latency?**
A fraction of a millisecond on a local hop, and it usually reduces total latency
by handling TLS session resumption, keepalive and caching better than an
application server would.

---

## Check your understanding

<Quiz
question="An application behind nginx redirects HTTP to HTTPS. Users get an infinite redirect loop. What is happening?"
options={[
{
text: 'The proxy terminates TLS and forwards plain HTTP, so the application sees an HTTP request and redirects — forever. It must trust X-Forwarded-Proto',
correct: true,
why: 'From the application’s perspective every request arrives over HTTP. Configuring it to read X-Forwarded-Proto makes it recognise that the client connection was already HTTPS.',
},
{text: 'The TLS certificate is invalid', why: 'That produces a browser warning before any redirect occurs.'},
{text: 'The redirect should be a 302 rather than a 301', why: 'Status code does not change the loop; the protocol detection does.'},
{text: 'HSTS is conflicting with the redirect', why: 'HSTS makes browsers use HTTPS directly, which would reduce rather than cause looping.'},
]}
explanation={<>The same root cause breaks <code>secure</code> cookies, since the framework declines to set them on what it believes is an insecure connection. Fix the trust configuration rather than removing the redirect.</>}
reference={{label: 'Trust configuration', href: '/knowledge-base/hosting/reverse-proxy#trust-configuration'}}
/>

<Quiz
question="Express is configured with `app.set('trust proxy', true)`. What is the security consequence?"
options={[
{
text: 'Any client can send their own X-Forwarded-For header and have it believed, spoofing their IP to evade rate limits, IP allowlists and audit logging',
correct: true,
why: 'true trusts every hop, including the client itself. The correct value is the number of proxies you actually have, or their specific addresses.',
},
{text: 'None — trust proxy only affects logging', why: 'It determines req.ip, which drives rate limiting, allowlists and audit records.'},
{text: 'It disables HTTPS detection', why: 'It enables protocol detection from headers; the problem is trusting them from anyone.'},
{text: 'It only matters if there is no proxy in front', why: 'The spoofing risk exists precisely because there is a proxy and the header is being read.'},
]}
explanation={<>Count the hops deliberately: a CDN in front of a load balancer in front of nginx is three. Trusting too few breaks the client IP; trusting too many lets clients forge it.</>}
reference={{label: 'Forwarded headers', href: '/knowledge-base/hosting/reverse-proxy#forwarded-headers'}}
/>

<Quiz
question="A PHP-FPM application with 20 workers becomes unresponsive under load from mobile users, though CPU is idle. How does a reverse proxy help?"
options={[
{
text: 'It buffers responses — accepting them quickly from the backend and drip-feeding slow clients, so a worker is freed immediately rather than waiting for the client to receive everything',
correct: true,
why: 'Without buffering, a worker is occupied for the whole time a slow client takes to read the response. A few hundred slow connections exhaust a fixed worker pool while the CPU sits idle.',
},
{text: 'It adds more PHP-FPM workers automatically', why: 'A proxy cannot change the backend’s worker configuration.'},
{text: 'It caches the responses so workers are not needed', why: 'Caching helps for cacheable content; the described problem affects dynamic responses too.'},
{text: 'It compresses responses, making them faster to send', why: 'Compression helps somewhat and does not address a worker being held for the transfer duration.'},
]}
explanation={<>This is one of the strongest and least-cited arguments for a reverse proxy in front of any thread- or process-per-request runtime.</>}
reference={{label: 'What it takes off your hands', href: '/knowledge-base/hosting/reverse-proxy#what-it-takes-off-your-hands'}}
/>

<Quiz
question="Which are genuine failure modes introduced by adding a reverse proxy?"
type="multiple"
options={[
{text: 'Body size limits lower than the application’s, producing 413 errors', correct: true, why: 'Nginx defaults to 1 MB, which is the usual cause of unexplained 413s on upload routes.'},
{text: 'Response buffering that breaks Server-Sent Events and streaming', correct: true, why: 'Nothing reaches the client until the buffer fills — the classic works-locally-fails-in-production streaming bug.'},
{text: 'Timeout mismatches, where the proxy gives up while the backend keeps working', correct: true, why: 'The client sees a 504 while the work continues invisibly, which is particularly confusing for non-idempotent operations.'},
{text: 'Header size limits below what the application accepts', correct: true, why: 'A large cookie or long Authorization header fails through the proxy but works when hitting the backend directly.'},
{text: 'Increased latency of several hundred milliseconds per request', why: 'A local proxy hop costs a fraction of a millisecond, and usually reduces total latency through better TLS resumption, keepalive and caching.'},
]}
explanation={<>The general debugging technique for all four: <code>curl</code> the proxy and the backend directly and compare. If the backend is correct and the proxy is not, it is configuration.</>}
reference={{label: 'The failure modes it introduces', href: '/knowledge-base/hosting/reverse-proxy#the-failure-modes-it-introduces'}}
/>

<Quiz
question="What is the practical difference between a liveness and a readiness health check?"
options={[
{
text: 'Liveness asks whether the process is alive so the orchestrator knows to restart it; readiness asks whether it can serve traffic, so a booting instance is not sent requests',
correct: true,
why: 'An instance that has started but not finished connecting to its database is alive but not ready. Routing to it produces errors during every deploy.',
},
{text: 'They are the same check exposed at two paths for redundancy', why: 'They answer different questions and drive different actions — restart versus route.'},
{text: 'Liveness is for the proxy, readiness is for monitoring dashboards', why: 'Both are consumed by the orchestrator or proxy; monitoring is separate.'},
{text: 'Readiness checks are only needed in Kubernetes', why: 'Any load balancer or proxy with health checking benefits from the distinction.'},
]}
explanation={<>Getting this wrong produces errors on every deploy: without a readiness check, traffic arrives at an instance that is still warming up, and users see failures for the few seconds it takes to become useful.</>}
reference={{label: 'Configuration that matters', href: '/knowledge-base/hosting/reverse-proxy#configuration-that-matters'}}
/>

---

## References

- [Nginx: Reverse proxy guide](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)
  — the canonical configuration reference.
- [RFC 7239: Forwarded HTTP Extension](https://www.rfc-editor.org/rfc/rfc7239) —
  the standardised header these `X-Forwarded-*` conventions predate.
- [Express: behind proxies](https://expressjs.com/en/guide/behind-proxies.html) —
  the `trust proxy` setting explained precisely.
- [Caddy reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy)
  — the minimal-configuration alternative.
- [Traefik](https://doc.traefik.io/traefik/) — dynamic discovery for containers.
- [Nginx](/knowledge-base/hosting/nginx) — the same material with full nginx
  specifics.
