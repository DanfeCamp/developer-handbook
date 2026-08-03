---
title: 'WebSockets'
description: 'Full-duplex, persistent connections between client and server — the handshake, reconnection, scaling across instances, security and when to use something simpler.'
---

# WebSockets

## Introduction

A WebSocket is a persistent, bidirectional connection between a client and a
server. Once established, either side can send a message at any time, with
minimal framing overhead and no new request.

**The problem it solves.** HTTP is request/response: the client asks, the server
answers, the connection ends. There is no way for the server to say something
first. Before WebSockets, people faked it with polling (wasteful and late) or
long-polling (a held-open request that must be re-established after every
message).

**What it costs.** A stateful connection per client, which is a genuine
architectural change: your servers now hold state, sticky routing or a shared
backplane becomes necessary, and reconnection logic is your responsibility.
Nothing about a WebSocket is as simple as a stateless HTTP request.

**Use it when you genuinely need bidirectional, low-latency communication** —
chat, collaborative editing, multiplayer, live trading, presence.

**Use something simpler when you do not.** If only the server pushes,
[Server-Sent Events](/knowledge-base/apis/server-sent-events) gives you that
over plain HTTP with automatic reconnection built in, and no new infrastructure.
The most common WebSocket mistake is choosing one for a notification feed.

---

## How It Works

A WebSocket connection begins as an ordinary HTTP request that asks to change
protocol:

```http
GET /ws HTTP/1.1
Host: api.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

After the `101`, the TCP connection stays open and both sides exchange **frames**
rather than HTTP messages. Frames carry text or binary, with a few bytes of
overhead each — which is why WebSockets suit high-frequency small messages.

Because the handshake is HTTP, it passes through most proxies and firewalls, and
`wss://` (TLS) is what makes it work reliably in practice. Plain `ws://` is
frequently mangled or blocked by intermediaries, quite apart from being
insecure.

**Ping/pong frames** are built into the protocol and exist for a reason:
intermediaries drop idle connections, often after 30–60 seconds, and a heartbeat
is what keeps the connection alive and detects a peer that has vanished without
closing.

---

## Client

```ts
const socket = new WebSocket('wss://api.example.com/ws');

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({type: 'subscribe', channel: 'orders'}));
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  handle(message);
});

socket.addEventListener('close', (event) => {
  // event.code tells you why. 1000 = normal, 1006 = abnormal (no close frame)
  scheduleReconnect();
});

socket.addEventListener('error', () => {
  // Deliberately uninformative for security reasons. Rely on `close`.
});
```

### Reconnection is your job

The browser does not reconnect a WebSocket. Networks drop, laptops sleep, phones
change from wifi to cellular, and proxies time out idle connections. **A
WebSocket client without reconnection logic is broken**, and it will look fine
in development.

```ts
let attempt = 0;

function connect() {
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    attempt = 0; // reset the backoff
    resubscribe(socket); // the server has no memory of your subscriptions
  });

  socket.addEventListener('close', (event) => {
    if (event.code === 1000) return; // deliberate close; do not reconnect

    // Exponential backoff with jitter, capped.
    const delay = Math.min(1000 * 2 ** attempt++, 30_000);
    setTimeout(connect, delay + Math.random() * 1000);
  });
}
```

**The jitter matters.** If a server restarts and ten thousand clients all
reconnect after exactly one second, you have a thundering herd that prevents the
server coming back up.

**Re-subscribe on reconnect.** The new connection is a new connection — the
server knows nothing about what the old one had subscribed to.

**Handle missed messages.** Anything sent while you were disconnected is gone.
Either send a "last received id" on reconnect and let the server replay, or
re-fetch current state over HTTP.

### Heartbeats

```ts
let heartbeat: ReturnType<typeof setInterval>;

socket.addEventListener('open', () => {
  heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: 'ping'}));
  }, 25_000); // shorter than the shortest proxy idle timeout in the path
});

socket.addEventListener('close', () => clearInterval(heartbeat));
```

Browsers cannot send protocol-level ping frames from JavaScript, so an
application-level ping is standard. Servers should send protocol pings and close
connections that stop responding — otherwise you accumulate "zombie" connections
consuming memory for clients that no longer exist.

---

## Server

```ts
import {WebSocketServer} from 'ws';

const wss = new WebSocketServer({noServer: true});

// Authenticate during the HTTP upgrade, before accepting the socket.
server.on('upgrade', async (request, socket, head) => {
  const user = await authenticate(request);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, user);
  });
});

wss.on('connection', (ws, request, user) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', async (raw) => {
    const message = JSON.parse(raw.toString());

    // Authorise EVERY message. The handshake check is not enough.
    if (!(await can(user, message))) return ws.close(1008, 'Policy violation');

    await handle(user, message, ws);
  });

  ws.on('close', () => cleanup(user, ws));
});

// Terminate connections that stop responding to pings.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
```

Two things in there are the ones people miss: **authenticating at the upgrade**
rather than after the socket is open, and **authorising every message** rather
than only the connection.

---

## Scaling Across Instances

The hard part, and the reason WebSockets change your architecture.

A WebSocket connection lives on **one specific server process**. With four
instances behind a load balancer, a message published on instance 1 cannot reach
a client connected to instance 3.

```text
client A ──── instance 1        publish "order updated" on instance 1
client B ──── instance 3   ←    B never sees it
```

Two things are needed:

**1. Sticky routing for the connection.** The upgrade request must reach an
instance that can hold the connection, and reconnects should ideally return to a
healthy one. Most load balancers handle a long-lived connection naturally once
established; the complication is HTTP-level session affinity if you rely on it.

**2. A backplane** so any instance can broadcast to any client:

```ts
// Redis pub/sub as a backplane
subscriber.subscribe('orders', (message) => {
  for (const ws of localClientsSubscribedTo('orders')) ws.send(message);
});

// Any instance can publish; every instance delivers to its own clients
await publisher.publish('orders', JSON.stringify(event));
```

Redis pub/sub is the common choice and is **fire-and-forget** — a message
published while an instance is restarting is lost. Where that matters, use
Redis Streams, NATS or Kafka, which persist. See
[Redis](/knowledge-base/redis) and [Kafka](/knowledge-base/kafka).

**Connection limits are real.** Each connection costs a file descriptor and
memory — roughly 10–50 KB depending on buffers. Tens of thousands per instance
is achievable with tuning; hundreds of thousands needs deliberate engineering.
Raise `ulimit -n` and the relevant kernel limits, or you will hit a ceiling far
below what the hardware can do.

**Serverless generally cannot hold WebSockets**, which is why AWS API Gateway
WebSocket APIs and Cloudflare Durable Objects exist as managed alternatives.

---

## Message Design

The protocol gives you a byte stream; the message format is yours.

```json
{
  "type": "order.updated",
  "id": "msg_01J9XQ",
  "seq": 4821,
  "data": {"orderId": "ord_1024", "status": "shipped"}
}
```

- **A `type` field**, so the client can dispatch.
- **A sequence number or id**, so a client can detect gaps after a reconnect and
  request a replay.
- **Version the protocol** — messages evolve, and old clients stay connected for
  a long time.
- **JSON by default.** Move to MessagePack or protobuf only when profiling shows
  serialisation or bandwidth is the constraint.
- **Keep messages small and frequent** rather than large and rare; that is what
  the framing overhead is optimised for.

---

## Security

WebSockets bypass several protections you get from HTTP by default.

**Cross-Site WebSocket Hijacking is the big one.** The same-origin policy does
**not** apply to WebSocket connections, and browsers send cookies with the
handshake. A malicious page can therefore open a WebSocket to your server as the
logged-in user.

```ts
// Always validate the Origin header on the upgrade request.
const allowed = new Set(['https://app.example.com']);
if (!allowed.has(request.headers.origin ?? '')) {
  socket.destroy();
  return;
}
```

Better still, **do not authenticate with cookies**. Use a short-lived token
obtained over HTTPS and sent in the first message after connecting, or as a
subprotocol value. A token in the query string works but lands in access logs.

The rest:

- **`wss://` only.** Never `ws://` outside local development.
- **Authorise every message**, not just the connection. A client that may read
  channel A must not be able to subscribe to channel B by sending a message.
- **Validate every message** against a schema. It is untrusted input exactly as
  a request body is.
- **Rate limit per connection**, and cap message size — an unbounded frame is a
  memory exhaustion vector.
- **Cap connections per user**, or one client can open thousands.
- **Never echo one user's input to others without sanitising**, or you have
  stored XSS with a real-time delivery mechanism. See
  [XSS](/knowledge-base/security/xss).

---

## WebSockets, SSE or Polling?

|                                  | Polling      | SSE             | WebSockets        |
| -------------------------------- | ------------ | --------------- | ----------------- |
| Direction                        | Client pulls | Server → client | Bidirectional     |
| Protocol                         | HTTP         | HTTP            | Upgraded TCP      |
| Auto-reconnect                   | N/A          | **Built in**    | You implement it  |
| Works with HTTP/2, proxies, CDNs | Yes          | Yes             | Sometimes awkward |
| Binary                           | No           | No              | Yes               |
| Server state                     | None         | Per connection  | Per connection    |
| Complexity                       | Lowest       | Low             | High              |

**Choose polling** when updates are infrequent and a delay is acceptable. It is
genuinely fine, and stateless.

**Choose SSE** when only the server pushes — notifications, live dashboards,
progress, streaming AI tokens. It runs over plain HTTP, reconnects
automatically, and needs no new infrastructure.

**Choose WebSockets** when the client also sends frequently and latency matters:
chat, collaborative editing, multiplayer, live cursors.

A common and good architecture is **SSE or polling for updates, plain HTTP POST
for client actions.** That gives you server push without any of the stateful
connection management, and it is enough for most applications that reach for
WebSockets.

---

## Libraries

Raw WebSockets are a low-level primitive. Most production systems use something
on top:

- **Socket.IO** — reconnection, rooms, acknowledgements, and a long-polling
  fallback. Not a standard WebSocket; needs its own client.
- **Phoenix Channels** (Elixir) — the strongest implementation of this model,
  with presence and a backplane built in.
- **Ably, Pusher, PubNub** — managed, so scaling and reconnection are somebody
  else's problem.
- **Cloudflare Durable Objects** — a stateful object per connection group, which
  neatly solves the backplane problem at the edge.
- **`ws`** (Node) — the minimal, standard-conforming server.

Using a library is usually right. The parts you would rewrite — reconnection
with backoff, heartbeats, rooms, a backplane — are exactly the parts that are
easy to get subtly wrong.

---

## Do's and Don'ts

### Do

- Use `wss://` everywhere but local development.
- Validate the `Origin` header on the upgrade.
- Authenticate at the upgrade, and authorise every message.
- Implement reconnection with exponential backoff **and jitter**.
- Re-subscribe and reconcile missed state after reconnecting.
- Send heartbeats, and terminate connections that stop responding.
- Include a type and a sequence number in every message.
- Use a backplane as soon as you have more than one instance.

### Don't

- Don't use WebSockets when SSE would do.
- Don't rely on cookie authentication for the handshake.
- Don't assume the connection stays open — it will not.
- Don't trust the connection-time authorisation for later messages.
- Don't broadcast from one instance and expect other instances' clients to hear
  it.
- Don't let clients send unbounded message sizes or rates.
- Don't ignore the `close` code; it tells you what happened.
- Don't put long-lived tokens in the connection URL.

---

## Debugging

| Symptom                               | Cause and fix                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Connection drops after ~60 seconds    | An idle proxy or load balancer timeout. Send heartbeats more often than the timeout.   |
| Works locally, fails in production    | A proxy not configured to forward `Upgrade`/`Connection` headers.                      |
| Close code 1006                       | Abnormal closure with no close frame — network, proxy or crash. Look at server logs.   |
| Some clients never receive broadcasts | Multiple instances with no backplane.                                                  |
| Memory grows steadily on the server   | Connections not cleaned up on close, or zombie connections. Add ping/pong termination. |
| Thundering herd after a deploy        | Reconnect backoff without jitter.                                                      |
| Client receives duplicate messages    | Reconnect without deduplication, or double subscription after re-subscribing.          |
| 401 on upgrade only in the browser    | Cookie not sent cross-origin, or `Origin` rejected.                                    |

Chrome DevTools → Network → the WS request → **Messages** shows every frame in
both directions, which is usually the fastest way to see what is actually being
exchanged.

---

## FAQ

**Do WebSockets work with HTTP/2 and HTTP/3?**
There is a bootstrapping mechanism (RFC 8441) but support is inconsistent.
WebSockets over HTTP/1.1 with TLS remains the reliable path. SSE, by contrast,
benefits directly from HTTP/2 multiplexing.

**How many connections can one server hold?**
Tens of thousands with tuning — file descriptor limits, kernel settings and
per-connection buffers all matter. Measure rather than assume.

**Can I use them on serverless?**
Not directly. Use a managed WebSocket layer (API Gateway, Ably) or a stateful
edge primitive (Durable Objects).

**Socket.IO or plain WebSockets?**
Socket.IO if you want rooms, acknowledgements and reconnection handled. Plain
`ws` if you need a standard WebSocket that any client can connect to — Socket.IO
is its own protocol.

**How do I test them?**
`wscat` or Postman for manual checks; Playwright can drive a real browser
connection end to end. Unit-test message handlers directly, without a socket.

**What about mobile clients?**
Expect frequent disconnection — backgrounding, network switching, poor
coverage. Backoff, resubscription and state reconciliation matter far more on
mobile than on desktop.

---

## Check your understanding

<Quiz
question="A team is building a notification feed: the server pushes updates, the client never sends anything over the channel. They plan to use WebSockets. What is the better choice?"
options={[
{
text: 'Server-Sent Events — one-way push over plain HTTP, with automatic reconnection built into the browser',
correct: true,
why: 'SSE covers server-to-client push with no new infrastructure, no upgrade handshake, and reconnection handled by EventSource. WebSockets add stateful bidirectional machinery that is not needed here.',
},
{text: 'WebSockets, because they are lower latency', why: 'The latency difference for occasional notifications is negligible, and it does not offset the reconnection and scaling work.'},
{text: 'Long polling, which is simpler than both', why: 'Simpler than WebSockets but worse than SSE — each message needs a new request and there is no standard reconnection.'},
{text: 'WebSockets, because SSE cannot carry JSON', why: 'SSE carries arbitrary text, including JSON. Only binary is unavailable.'},
]}
explanation={<>A very effective architecture is SSE (or polling) for server push plus ordinary HTTP POST for client actions — server push without any stateful connection management.</>}
reference={{label: 'WebSockets, SSE or polling?', href: '/knowledge-base/apis/websockets#websockets-sse-or-polling'}}
/>

<Quiz
question="An app scales from one server to four behind a load balancer. Clients now receive only some broadcasts. Why?"
options={[
{
text: 'Each connection lives on one instance, so a message published on instance 1 never reaches clients connected to instances 2–4 — a backplane is needed',
correct: true,
why: 'WebSocket connections are process-local state. Redis pub/sub, NATS or Kafka lets any instance publish and every instance deliver to its own clients.',
},
{text: 'The load balancer is not configured for sticky sessions', why: 'Stickiness affects which instance a client reaches; it does not let instances broadcast to each other’s clients.'},
{text: 'Four instances exceed the connection limit', why: 'More instances raise the total capacity, not lower it.'},
{text: 'Clients need to reconnect after scaling', why: 'Existing connections are fine — the problem is that broadcasts do not cross instance boundaries.'},
]}
explanation={<>Note that Redis pub/sub is fire-and-forget: a message published while an instance is restarting is simply lost. Where delivery must be guaranteed, use Redis Streams, NATS JetStream or Kafka.</>}
reference={{label: 'Scaling across instances', href: '/knowledge-base/apis/websockets#scaling-across-instances'}}
/>

<Quiz
question="Why is validating the Origin header on a WebSocket upgrade essential?"
options={[
{
text: 'The same-origin policy does not apply to WebSockets, but browsers still send cookies with the handshake — so any site can open an authenticated connection as the logged-in user',
correct: true,
why: 'This is Cross-Site WebSocket Hijacking. Unlike fetch, there is no CORS preflight to block the connection, so Origin validation is the server’s only equivalent defence.',
},
{text: 'Origin is required by the WebSocket protocol specification', why: 'Browsers send it, but the protocol does not require the server to validate it — which is exactly why it gets forgotten.'},
{text: 'It prevents man-in-the-middle attacks', why: 'That is what wss:// and TLS provide. Origin validation addresses cross-site connection initiation.'},
{text: 'CORS handles it automatically for WebSockets', why: 'CORS does not apply to WebSocket connections at all — the central point.'},
]}
explanation={<>The stronger fix is not to authenticate with cookies: use a short-lived token fetched over HTTPS and presented after connecting, so an attacker's page has nothing to replay.</>}
reference={{label: 'Security', href: '/knowledge-base/apis/websockets#security'}}
/>

<Quiz
question="Which of these must a production WebSocket client implement?"
type="multiple"
options={[
{text: 'Reconnection with exponential backoff and jitter', correct: true, why: 'The browser does not reconnect for you, and without jitter a server restart produces a thundering herd of simultaneous reconnects.'},
{text: 'Re-subscribing to channels after reconnecting', correct: true, why: 'A new connection is a new connection — the server has no memory of the previous one’s subscriptions.'},
{text: 'Reconciling state missed while disconnected', correct: true, why: 'Messages sent during the gap are gone. Either replay from a last-received id, or re-fetch current state over HTTP.'},
{text: 'Application-level heartbeats', correct: true, why: 'Intermediaries drop idle connections, often within 60 seconds, and browsers cannot send protocol-level pings from JavaScript.'},
{text: 'Retrying the initial handshake on a 401', why: 'A 401 means the credentials are wrong. Retrying without fixing them is a loop; obtain a fresh token instead.'},
]}
explanation={<>These four are precisely the parts a library like Socket.IO or a managed service provides — which is usually the argument for using one.</>}
reference={{label: 'Reconnection is your job', href: '/knowledge-base/apis/websockets#reconnection-is-your-job'}}
/>

<Quiz
question="A chat server authenticates the user during the upgrade handshake and then trusts the connection. What is the flaw?"
options={[
{
text: 'Authentication is not authorisation — the user can send a message subscribing to a channel they have no right to read',
correct: true,
why: 'The handshake establishes who they are. Every subsequent message is a new action needing its own permission check, exactly as each HTTP request would.',
},
{text: 'The handshake token may expire during a long-lived connection', why: 'A genuine secondary concern worth handling, but the immediate flaw is the missing per-message check.'},
{text: 'Nothing — a connection-level check is the standard pattern', why: 'It is a common pattern and an insecure one, equivalent to authorising a REST API only at login.'},
{text: 'The Origin header should be checked per message instead', why: 'Origin is only present on the handshake; it cannot be validated per frame.'},
]}
explanation={<>The same reasoning as broken object-level authorisation in REST: proving identity says nothing about whether this user may touch <em>this</em> resource. Validate and authorise every inbound message.</>}
reference={{label: 'Server', href: '/knowledge-base/apis/websockets#server'}}
/>

---

## References

- [MDN: The WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
  — client API, close codes, and usage guidance.
- [RFC 6455: The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455) —
  the handshake, framing and close codes.
- [OWASP: Testing WebSockets](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/10-Testing_WebSockets)
  — including Cross-Site WebSocket Hijacking.
- [ws](https://github.com/websockets/ws) — the standard Node implementation.
- [Socket.IO](https://socket.io/docs/v4/) — rooms, acknowledgements, fallbacks.
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
  — stateful WebSocket handling without managing servers.
