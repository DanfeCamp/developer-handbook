---
title: 'Nginx'
description: 'A high-performance web server, reverse proxy and load balancer — configuration structure, location matching, proxying, static files, caching and debugging.'
---

# Nginx

## Introduction

Nginx is an event-driven web server, reverse proxy, load balancer and cache. It
handles tens of thousands of concurrent connections on modest hardware, which is
why it sits in front of a very large share of the web.

**Why event-driven matters.** Apache's traditional model allocates a process or
thread per connection, so ten thousand idle keep-alive connections cost ten
thousand threads. Nginx uses a small number of worker processes with an event
loop, so an idle connection costs a file descriptor and a few kilobytes. This is
the whole reason it displaced Apache for high-concurrency workloads.

**What you actually use it for**, in rough order of frequency:

1. **Reverse proxy** in front of an application server.
2. **TLS termination**, so your application speaks plain HTTP.
3. **Serving static files** — far faster than any application runtime.
4. **Load balancing** across several backends.
5. **Caching**, rate limiting and compression.

**Alternatives worth knowing.** **Caddy** obtains and renews TLS certificates
automatically with almost no configuration, which makes it a better default for
a simple deployment. **Traefik** discovers containers dynamically, which suits
Docker and Kubernetes. **HAProxy** is stronger at pure load balancing. Nginx
remains the most widely deployed and the most documented.

---

## Configuration Structure

```nginx
# /etc/nginx/nginx.conf
user www-data;
worker_processes auto;          # one per CPU core

events {
    worker_connections 1024;    # per worker
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    sendfile      on;           # kernel-level file sending
    tcp_nopush    on;
    keepalive_timeout 65;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
```

Directives nest in **contexts** — `http`, `server`, `location` — and inherit
downwards. A directive set in `http` applies to every `server` unless
overridden.

**The inheritance trap:** `add_header` does **not** merge. If a `location` block
sets any `add_header`, every `add_header` from the parent context is discarded
for that location. This is how security headers silently disappear from one
route. Use `always` and repeat them, or use the `headers-more` module.

---

## Server Blocks

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://example.com$request_uri;   # canonical redirect
}

server {
    listen 443 ssl;
    http2 on;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    root /var/www/example.com/public;
    index index.html;

    access_log /var/log/nginx/example.access.log;
    error_log  /var/log/nginx/example.error.log warn;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**`return 301` rather than `rewrite`** for redirects — it is faster and clearer.

**The default server** handles requests whose `Host` matches no `server_name`.
Define one explicitly and have it return `444` (close without response), or a
scanner hitting your IP directly gets whichever site happens to be first.

```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    ssl_reject_handshake on;
    return 444;
}
```

---

## Location Matching

The part that causes most confusion, because the order of _evaluation_ is not
the order in the file.

| Modifier | Meaning                            | Priority                          |
| -------- | ---------------------------------- | --------------------------------- |
| `=`      | Exact match                        | 1 — wins immediately              |
| `^~`     | Prefix match, stop searching regex | 2                                 |
| `~`      | Case-sensitive regex               | 3 — **first match in file order** |
| `~*`     | Case-insensitive regex             | 3                                 |
| (none)   | Prefix match                       | 4 — longest match wins            |

```nginx
location = /health        { return 200 'ok'; }        # exact, fastest
location ^~ /assets/      { expires 1y; }             # prefix, skips regex
location ~* \.(jpg|png)$  { expires 30d; }            # regex
location /                { proxy_pass http://app; }  # catch-all prefix
```

**Two rules that resolve most surprises:**

1. **Prefix matches are evaluated by length, not file order.** The longest
   matching prefix wins, wherever it appears.
2. **Regex matches are evaluated in file order**, and the first match wins — so
   reordering regex blocks changes behaviour.

**The `proxy_pass` trailing slash** is the single most consequential character in
nginx configuration:

```nginx
location /api/ {
    proxy_pass http://backend;      # /api/users → /api/users   (path preserved)
}

location /api/ {
    proxy_pass http://backend/;     # /api/users → /users       (prefix stripped)
}
```

A trailing slash on `proxy_pass` **replaces** the matched location prefix.
Without it, the full path is passed through. Getting this wrong produces 404s
that look like a routing bug in the application.

---

## Reverse Proxying

```nginx
upstream app {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    keepalive 32;              # reuse connections to the backend
}

server {
    listen 443 ssl;
    server_name example.com;

    location / {
        proxy_pass http://app;
        proxy_http_version 1.1;

        # Without these, the app sees nginx's IP and thinks every request is HTTP
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # Required for WebSockets and SSE
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 5s;
        proxy_read_timeout    60s;
        proxy_send_timeout    60s;
    }
}
```

**The forwarded headers are not optional.** Without them your application logs
`127.0.0.1` for every visitor, rate limiting counts all users as one client, and
`req.protocol` reports HTTP — which breaks `secure` cookie handling. Your
application must also be configured to trust them; see
[Reverse Proxy](/knowledge-base/hosting/reverse-proxy).

**Buffering matters for streaming.** Nginx buffers proxied responses by default,
which breaks Server-Sent Events and streamed LLM responses — nothing reaches the
client until the buffer fills:

```nginx
location /api/stream {
    proxy_pass http://app;
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding on;
}
```

The application can also signal this per response with `X-Accel-Buffering: no`.
See [Server-Sent Events](/knowledge-base/apis/server-sent-events).

**Load balancing methods:** round-robin (default), `least_conn` (best for
uneven request durations), and `ip_hash` (session affinity — a workaround that
reintroduces state; prefer a shared session store).

---

## Static Files

The thing nginx does far better than any application server.

```nginx
# Hashed build assets — immutable, cache forever
location ~* \.(?:js|css|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
}

# Images
location ~* \.(?:jpg|jpeg|png|gif|webp|avif|svg|ico)$ {
    expires 30d;
    add_header Cache-Control "public";
}

# Pre-compressed files, if the build produces them
gzip_static on;
brotli_static on;   # requires the brotli module
```

**`gzip_static` and `brotli_static`** serve `.gz` and `.br` files produced at
build time rather than compressing on every request — better compression, less
CPU.

**Serve user uploads from a separate origin**, or with
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. An
uploaded SVG served from your application origin is stored XSS. See
[File Uploads](/knowledge-base/web/file-uploads).

---

## Rate Limiting and Protection

```nginx
http {
    # 10 MB zone holds roughly 160,000 IP addresses
    limit_req_zone  $binary_remote_addr zone=general:10m rate=30r/s;
    limit_req_zone  $binary_remote_addr zone=login:10m   rate=5r/m;
    limit_conn_zone $binary_remote_addr zone=conn:10m;
}

server {
    client_max_body_size 10m;      # cap uploads at the proxy, not just the app
    client_body_timeout  15s;

    location / {
        limit_req  zone=general burst=50 nodelay;
        limit_conn conn 20;
        proxy_pass http://app;
    }

    location /api/auth/login {
        limit_req zone=login burst=5;   # much stricter
        proxy_pass http://app;
    }

    server_tokens off;              # do not advertise the nginx version
}
```

**`client_max_body_size` is the limit that actually protects you** — it rejects
an oversized upload before your application allocates anything. The default is
1 MB, which is the cause of most unexplained `413` errors.

`burst` allows a short spike; `nodelay` serves burst requests immediately rather
than queuing them.

---

## Caching

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app:10m
                 max_size=1g inactive=60m use_temp_path=off;

location /api/public/ {
    proxy_cache app;
    proxy_cache_valid 200 5m;
    proxy_cache_valid 404 1m;

    # Serve stale content rather than an error when the backend struggles
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503;
    proxy_cache_background_update on;
    proxy_cache_lock on;                 # one request repopulates; others wait

    add_header X-Cache-Status $upstream_cache_status;   # HIT / MISS / STALE
    proxy_pass http://app;
}
```

**`proxy_cache_use_stale` with `background_update`** is the standout feature:
when the backend is down or slow, nginx keeps serving the last good response
instead of a 502. It turns a hard outage into stale content, which is almost
always preferable.

**`proxy_cache_lock`** prevents a cache stampede — when a popular entry expires,
one request repopulates it while the others wait, rather than all of them
hitting the backend at once. See
[Caching](/knowledge-base/operations/caching).

**Never cache authenticated responses** without keying on the user, or one
user's data is served to another.

---

## Operations

```bash
nginx -t                    # ALWAYS test before reloading
systemctl reload nginx      # graceful: no dropped connections
systemctl restart nginx     # drops connections — avoid in production
nginx -T                    # dump the full effective configuration
```

**`nginx -t` before every reload.** A syntax error on restart leaves nginx down;
`reload` refuses to apply a broken config, but only if you have not already
restarted.

**Reload is graceful** — existing connections finish on the old workers while
new ones use the new configuration. There is no reason to restart for a config
change.

**Structured logging** makes logs useful downstream:

```nginx
log_format json escape=json '{'
  '"time":"$time_iso8601",'
  '"remote_addr":"$remote_addr",'
  '"request":"$request",'
  '"status":$status,'
  '"bytes":$body_bytes_sent,'
  '"request_time":$request_time,'
  '"upstream_time":"$upstream_response_time",'
  '"referer":"$http_referer",'
  '"user_agent":"$http_user_agent"'
'}';

access_log /var/log/nginx/access.log json;
```

`$request_time` versus `$upstream_response_time` is the key diagnostic pair: if
request time is much larger, the delay is in the network or the client, not your
application. See [Logging](/knowledge-base/operations/logging).

---

## Debugging

| Symptom                                         | Cause and fix                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| **502 Bad Gateway**                             | Backend down, wrong port, or crashed. Check the app first.                   |
| **504 Gateway Timeout**                         | Backend too slow. Raise `proxy_read_timeout`, and fix the slow endpoint.     |
| **413 Request Entity Too Large**                | `client_max_body_size` — default 1 MB.                                       |
| **404 through the proxy, works directly**       | The `proxy_pass` trailing slash.                                             |
| Security headers missing on one route           | A `location` block with its own `add_header` discarded the parent's.         |
| SSE or streaming delivers nothing until the end | `proxy_buffering` on. Turn it off for that location.                         |
| WebSocket connection fails                      | Missing `Upgrade` and `Connection` headers, or `proxy_http_version 1.1`.     |
| App logs show 127.0.0.1 for every visitor       | Forwarded headers not set, or not trusted by the app.                        |
| Wrong site served                               | Request matched the default server — `Host` did not match any `server_name`. |
| Config change had no effect                     | Not reloaded, or a different block matched. Check `nginx -T`.                |

```bash
nginx -T | grep -A 20 "server_name example.com"   # what is actually loaded
tail -f /var/log/nginx/error.log
curl -I -H "Host: example.com" http://127.0.0.1   # bypass DNS
```

**A 502 is almost never nginx's fault.** Check whether the backend is running
and listening on the expected address before touching the proxy configuration.

---

## Do's and Don'ts

### Do

- Run `nginx -t` before every reload, and use `reload` rather than `restart`.
- Set the forwarded headers, and configure the application to trust them.
- Define an explicit default server that rejects unmatched hosts.
- Set `client_max_body_size` deliberately.
- Disable `proxy_buffering` for streaming endpoints.
- Serve static assets from nginx with long cache headers.
- Use `proxy_cache_use_stale` so a backend failure degrades rather than errors.
- Log as JSON, including `$request_time` and `$upstream_response_time`.
- Turn off `server_tokens`.

### Don't

- Don't forget the `proxy_pass` trailing-slash distinction.
- Don't assume `add_header` merges across contexts.
- Don't use `ip_hash` as a substitute for a shared session store.
- Don't cache authenticated responses without keying on the user.
- Don't hand-write cipher suites — use Mozilla's generator.
- Don't restart in production for a configuration change.
- Don't serve user uploads from your application origin.
- Don't leave `client_max_body_size` at its 1 MB default and wonder about 413s.

---

## Common Mistakes

**The `proxy_pass` trailing slash.** Produces 404s that look like an application
routing bug.

**`add_header` inheritance.** Security headers present everywhere except the one
location that sets its own.

**Assuming file order controls `location` matching.** Prefix matches are chosen
by length; only regex blocks are order-dependent.

**Leaving `proxy_buffering` on for SSE.** The classic "works locally, dead in
production" streaming failure.

**No default server.** A request with an unmatched `Host` gets whichever site is
first.

**Restarting instead of reloading.** Dropped connections for no reason.

**Debugging nginx when the backend is down.** A 502 means the upstream did not
answer.

**Not trusting proxy headers in the application.** Rate limiting then counts
every user as one client, and `secure` cookies are not set.

---

## FAQ

**Nginx or Caddy?**
Caddy for a simple deployment — automatic HTTPS with no configuration is a
genuine advantage. Nginx when you need its performance characteristics, module
ecosystem, or the enormous body of existing documentation.

**Nginx or Traefik?**
Traefik for containerised environments where backends come and go, because it
discovers them dynamically. Nginx for static topologies.

**Do I need nginx in front of Node?**
Not strictly, and it is usually worth it: TLS termination, static file serving,
rate limiting, buffering slow clients away from your event loop, and graceful
handling of backend restarts.

**How many worker processes?**
`worker_processes auto` — one per core. The default is right.

**Nginx or Nginx Plus?**
The open-source build covers almost everything. Plus adds active health checks,
dynamic upstream reconfiguration and support.

**How do I do blue-green deployment?**
Change the `upstream` block and `reload`. Existing connections drain on the old
workers; new ones go to the new backend.

---

## Check your understanding

<Quiz
question="A location block proxies /api/ to a backend. Requests to /api/users return 404 from the application, though the route exists. What is the likely cause?"
options={[
{
text: 'A trailing slash on proxy_pass — with http://backend/ the matched /api/ prefix is stripped, so the backend receives /users instead of /api/users',
correct: true,
why: 'A trailing slash on proxy_pass replaces the matched location prefix; without one the full path passes through. It is a single character with completely different behaviour.',
},
{text: 'The backend is not running', why: 'That produces a 502 from nginx, not a 404 from the application.'},
{text: 'proxy_set_header Host is missing', why: 'That affects virtual host routing and header-based logic, not the path.'},
{text: 'The location needs a regex modifier', why: 'A prefix match handles /api/ correctly; the path rewriting is what differs.'},
]}
explanation={<>Confirm what the backend actually receives by logging the request path there, or run <code>nginx -T</code> and read the effective configuration. This is the most common nginx proxy mistake.</>}
reference={{label: 'Location matching', href: '/knowledge-base/hosting/nginx#location-matching'}}
/>

<Quiz
question="Security headers set in the server block are present on most routes but missing under /api/. That location sets its own add_header for CORS. Why?"
options={[
{
text: 'add_header does not merge — if a location sets any add_header, every add_header inherited from the parent context is discarded for that location',
correct: true,
why: 'Nginx replaces rather than merges the directive set. The fix is to repeat the parent headers in that location, or use the headers-more module.',
},
{text: 'CORS headers override security headers by specification', why: 'There is no such precedence; this is nginx directive inheritance behaviour.'},
{text: 'The location block needs the always flag on the parent headers', why: 'always controls whether headers are added to error responses. It does not restore discarded inheritance.'},
{text: 'Headers cannot be set in a location block', why: 'They can — which is exactly what triggers the replacement.'},
]}
explanation={<>This inheritance rule is unusual and catches almost everyone. Audit with <code>curl -I</code> on each route rather than assuming headers set at the server level apply everywhere.</>}
reference={{label: 'Configuration structure', href: '/knowledge-base/hosting/nginx#configuration-structure'}}
/>

<Quiz
question="An SSE endpoint streams correctly when tested against the application directly, but through nginx nothing arrives until the stream ends. What is the fix?"
options={[
{
text: 'Disable proxy_buffering for that location — nginx buffers proxied responses by default and accumulates output instead of forwarding each chunk',
correct: true,
why: 'Buffering is helpful for normal responses and fatal for streaming. Set proxy_buffering off, or have the application send X-Accel-Buffering: no.',
},
{text: 'Enable HTTP/2 on the listener', why: 'HTTP/2 helps with connection limits, not with proxy buffering.'},
{text: 'Increase proxy_read_timeout', why: 'A timeout would sever the stream, not delay delivery until completion.'},
{text: 'Add the Upgrade and Connection headers', why: 'Those are required for WebSockets. SSE is ordinary HTTP.'},
]}
explanation={<>This is the single most common "works locally, dead in production" cause for SSE and streamed LLM responses, because there is no proxy in local development.</>}
reference={{label: 'Reverse proxying', href: '/knowledge-base/hosting/nginx#reverse-proxying'}}
/>

<Quiz
question="Which nginx settings genuinely protect the application behind it?"
type="multiple"
options={[
{text: 'client_max_body_size, capping upload size before the application allocates anything', correct: true, why: 'The proxy rejects the request first, so an oversized upload never reaches your process. The 1 MB default also explains most unexplained 413 errors.'},
{text: 'limit_req with a stricter zone on authentication endpoints', correct: true, why: 'Brute-force and credential-stuffing traffic is rejected at the edge rather than consuming application capacity.'},
{text: 'proxy_cache_use_stale with background update', correct: true, why: 'When the backend fails, users get slightly stale content instead of a 502 — a hard outage becomes a soft one.'},
{text: 'proxy_cache_lock, so one request repopulates an expired entry while others wait', correct: true, why: 'Prevents a cache stampede hitting the backend simultaneously when a popular entry expires.'},
{text: 'server_tokens off, hiding the nginx version', why: 'Worth setting, and it is obscurity rather than protection — it does not stop any attack.'},
]}
explanation={<>The first four all shed or absorb load before it reaches your application, which is the main operational argument for putting a reverse proxy in front of an app server at all.</>}
reference={{label: 'Rate limiting and protection', href: '/knowledge-base/hosting/nginx#rate-limiting-and-protection'}}
/>

<Quiz
question="Nginx returns 502 Bad Gateway. Where should you look first?"
options={[
{
text: 'The backend application — 502 means the upstream did not respond, so check whether it is running and listening on the expected address',
correct: true,
why: 'A 502 is nginx reporting that it could not get an answer. Editing proxy configuration when the application has crashed wastes time.',
},
{text: 'The TLS certificate configuration', why: 'A certificate problem fails the handshake before any request reaches the proxy logic.'},
{text: 'The location matching rules', why: 'A location mismatch produces a 404 or the wrong content, not a 502.'},
{text: 'DNS records for the domain', why: 'If DNS were wrong the request would not reach nginx at all.'},
]}
explanation={<>Distinguish it from 504: 502 means no usable response, 504 means the backend was too slow. The first is usually a crash or wrong port; the second is a slow endpoint or too short a <code>proxy_read_timeout</code>.</>}
reference={{label: 'Debugging', href: '/knowledge-base/hosting/nginx#debugging'}}
/>

---

## References

- [Nginx documentation](https://nginx.org/en/docs/) — the authoritative
  directive reference.
- [Nginx Admin Guide](https://docs.nginx.com/nginx/admin-guide/) — task-oriented
  guides for proxying, load balancing and caching.
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) —
  correct TLS configuration for nginx.
- [DigitalOcean: Understanding Nginx server and location block selection](https://www.digitalocean.com/community/tutorials/understanding-nginx-server-and-location-block-selection-algorithms)
  — the clearest explanation of matching order.
- [Caddy](https://caddyserver.com/) and [Traefik](https://traefik.io/) — the
  main alternatives.
- [Reverse Proxy](/knowledge-base/hosting/reverse-proxy) — the concepts, without
  the nginx specifics.
