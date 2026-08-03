---
title: 'Server-Sent Events'
description: 'One-way streaming from server to browser over HTTP — the wire format, automatic reconnection with Last-Event-ID, proxy pitfalls and when SSE beats WebSockets.'
---

# Server-Sent Events

## Introduction

Server-Sent Events (SSE) is a standard for a server to push a stream of messages
to a client over an ordinary HTTP response that is never closed. The client
opens a `GET`, the server holds it open and writes messages as they occur.

**The problem it solves.** HTTP is request/response, so the server cannot speak
first. [WebSockets](/knowledge-base/apis/websockets) solve that with a protocol
upgrade and a stateful bidirectional channel — which is often more machinery
than the situation needs. SSE gives you server push while remaining plain HTTP.

**What that means in practice:**

- **Automatic reconnection**, built into the browser. You write no reconnect
  logic at all.
- **Message replay** via `Last-Event-ID`, so a client recovers what it missed.
- **Works with existing infrastructure** — HTTP/2, proxies, CDNs, auth headers,
  compression. No upgrade handshake to configure.
- **Text only, one direction.** The client sends nothing over the stream; it
  uses ordinary HTTP requests for that.

**Where it fits:** notifications, live dashboards, progress indicators, feeds,
build logs, and — the use that made SSE mainstream again — **streaming LLM
tokens**. Every major AI provider streams completions over SSE.

**Where it does not:** anything needing high-frequency client-to-server
messages, binary payloads, or genuine bidirectional exchange. That is
WebSockets.

:::tip The default choice for server push
If only the server pushes, start with SSE. It is less code, less
infrastructure, and the reconnection logic you would otherwise hand-write for a
WebSocket is already correct in the browser.
:::

---

## The Wire Format

SSE is a plain text format over `text/event-stream`. Fields are `name: value`
lines; a **blank line dispatches the event**.

```text
data: Hello

event: order.updated
id: 1042
data: {"orderId":"ord_1024","status":"shipped"}

: this is a comment, used as a keep-alive

retry: 5000

data: line one
data: line two
```

| Field    | Purpose                                                                   |
| -------- | ------------------------------------------------------------------------- |
| `data:`  | The payload. Repeat it for multi-line content; the client joins with `\n` |
| `event:` | A named type. Without it, the client fires the generic `message` event    |
| `id:`    | Sets the client's last-event id, sent back on reconnect                   |
| `retry:` | Reconnection delay in milliseconds                                        |
| `:`      | A comment. Ignored — and the standard keep-alive mechanism                |

Two details bite people:

- **The double newline is mandatory.** A message without a blank line after it is
  never dispatched, and the client simply waits. This is the most common "my SSE
  does not work" cause.
- **`data:` cannot contain a raw newline.** Serialise JSON to a single line, or
  split it across repeated `data:` fields.

---

## Client

```ts
const events = new EventSource('/api/events');

// Generic messages — those with no `event:` field
events.addEventListener('message', (e) => {
  console.log(e.data);
});

// Named events
events.addEventListener('order.updated', (e) => {
  const order = JSON.parse(e.data);
  update(order);
});

events.addEventListener('error', () => {
  // EventSource reconnects automatically unless readyState is CLOSED.
  if (events.readyState === EventSource.CLOSED) {
    // The server sent 204, or close() was called. It will not retry.
  }
});

// Stop it explicitly — otherwise it reconnects forever
events.close();
```

**Reconnection is automatic**, which is the headline advantage. On a dropped
connection the browser waits (`retry:` milliseconds, default around 3 seconds)
and reconnects, sending the last id it received:

```http
GET /api/events HTTP/1.1
Accept: text/event-stream
Last-Event-ID: 1042
```

The server can then replay everything after 1042. This is a genuinely good
recovery story and it costs you almost nothing — but **only if you emit `id:`
and honour `Last-Event-ID` on the server**. Skip either and reconnection
silently loses messages.

### The EventSource limitations

`EventSource` cannot set headers. No `Authorization`, no custom headers — it
sends cookies and nothing else. There are three ways round it:

1. **Cookie authentication** with `withCredentials: true`. Simple, and pulls in
   CSRF considerations.
2. **A short-lived token in the query string.** Works everywhere; the token
   lands in access logs, so keep its lifetime short.
3. **`fetch` with a streaming body reader** instead of `EventSource` — full
   header control, at the cost of implementing reconnection yourself.

```ts
// fetch-based: headers work, but you own the reconnection logic
const response = await fetch('/api/events', {
  headers: {Authorization: `Bearer ${token}`, Accept: 'text/event-stream'},
});

const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
for (;;) {
  const {value, done} = await reader.read();
  if (done) break;
  parseSseChunk(value); // you must buffer partial events across chunks
}
```

Libraries such as `@microsoft/fetch-event-source` combine header support with
reconnection, which is usually the right answer when you need both.

**Also note:** with HTTP/1.1 browsers cap connections at roughly six per origin,
and an open SSE stream consumes one — across every tab. Several tabs on the same
origin can exhaust the budget and stall ordinary requests. **HTTP/2 removes
this**, which is a strong reason to serve SSE over HTTP/2.

---

## Server

```ts title="Route handler (Web Streams)"
export async function GET(request: Request) {
  const lastEventId = request.headers.get('last-event-id');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, id?: string) => {
        let frame = '';
        if (id) frame += `id: ${id}\n`;
        if (event) frame += `event: ${event}\n`;
        frame += `data: ${JSON.stringify(data)}\n\n`; // blank line dispatches
        controller.enqueue(encoder.encode(frame));
      };

      // Replay anything missed since the client last connected.
      if (lastEventId) {
        for (const e of await getEventsAfter(lastEventId)) send(e.type, e.data, e.id);
      }

      // Keep-alive comment — prevents proxy idle timeouts closing the stream.
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15_000);

      const unsubscribe = subscribe((e) => send(e.type, e.data, e.id));

      // Clean up when the client disconnects. Without this you leak subscriptions.
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell nginx not to buffer
    },
  });
}
```

Four headers, each solving a real problem:

- **`Content-Type: text/event-stream`** — required, or the browser will not
  treat it as a stream.
- **`Cache-Control: no-cache, no-transform`** — `no-transform` stops proxies
  rewriting or compressing the body in ways that break framing.
- **`X-Accel-Buffering: no`** — nginx buffers proxied responses by default, so
  without this nothing reaches the client until the buffer fills. This is the
  single most common "works locally, broken in production" cause for SSE.
- **A keep-alive comment every 15–30 seconds** — load balancers and proxies close
  idle connections, often at 60 seconds.

**Clean up on disconnect.** The client vanishing does not automatically release
your subscription, database cursor or interval. Listen for the abort signal;
otherwise every disconnected client leaks resources until the process is
restarted.

---

## Streaming LLM Responses

The use case that brought SSE back into the mainstream. Tokens arrive as they
are generated rather than after the whole completion:

```ts
export async function POST(request: Request) {
  const {prompt} = await request.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of model.stream(prompt)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({token: chunk})}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {headers: {'Content-Type': 'text/event-stream'}});
}
```

Note this is a `POST`, so `EventSource` cannot consume it — use the `fetch`
streaming approach on the client. The `[DONE]` sentinel is an OpenAI convention
rather than part of SSE; a named `event: done` is cleaner if you control both
ends.

---

## Scaling

The same constraint as WebSockets: **an open stream lives on one server
process.**

- **Every connection occupies a worker or a connection slot** for its whole
  lifetime. This is fine on an async runtime (Node, Go, ASGI Python) and
  expensive on a thread-per-request model — a PHP-FPM pool has a fixed number of
  workers, and long-held SSE connections will exhaust it.
- **A backplane is required with more than one instance.** An event published on
  instance 1 must reach clients connected to instances 2 and 3, via Redis
  pub/sub, NATS or similar. See [Redis](/knowledge-base/redis).
- **Serverless usually cannot hold long connections**, or bills you for the
  entire duration. Check the platform's timeout — many cap at 30–300 seconds.
- **Set a maximum stream lifetime** (say 30 minutes) and close deliberately. The
  browser reconnects automatically, which recycles server resources and
  rebalances clients across instances.
- **Serve over HTTP/2** to avoid the six-connection-per-origin limit.

For genuinely large fan-out — tens of thousands of concurrent streams — a
managed service or a purpose-built layer is worth considering before you build
one.

---

## SSE, WebSockets or Polling?

|                        | Polling      | **SSE**                    | WebSockets                |
| ---------------------- | ------------ | -------------------------- | ------------------------- |
| Direction              | Client pulls | **Server → client**        | Bidirectional             |
| Protocol               | HTTP         | **HTTP**                   | Upgraded TCP              |
| Auto-reconnect         | N/A          | **Built in**               | You implement it          |
| Replay after reconnect | N/A          | **`Last-Event-ID`**        | You implement it          |
| Binary                 | No           | **No**                     | Yes                       |
| Custom headers         | Yes          | **Not with `EventSource`** | Limited                   |
| Infrastructure         | None         | **None**                   | Backplane, sticky routing |
| Complexity             | Lowest       | **Low**                    | High                      |

**The decision is simple.** Does the client need to send frequently over the
same channel? If no, use SSE. If yes, use WebSockets.

A very common and effective pattern: **SSE for server push, ordinary HTTP POST
for client actions.** You get real-time updates with no stateful bidirectional
protocol, and the client half is just `fetch`.

---

## Do's and Don'ts

### Do

- End every message with a blank line.
- Emit `id:` and honour `Last-Event-ID` so reconnection replays correctly.
- Send a keep-alive comment every 15–30 seconds.
- Set `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`.
- Clean up subscriptions on the request's abort signal.
- Serve over HTTP/2.
- Cap stream lifetime and let the browser reconnect.
- Use named events so clients can dispatch.

### Don't

- Don't put raw newlines inside a `data:` value.
- Don't use `EventSource` when you need an `Authorization` header — use `fetch`
  streaming, or a library.
- Don't forget that an unclosed `EventSource` reconnects forever.
- Don't run SSE on a thread-per-request server with a small worker pool.
- Don't broadcast from one instance without a backplane.
- Don't send binary — SSE is UTF-8 text only.
- Don't rely on SSE for client-to-server messages.
- Don't leave streams open indefinitely.

---

## Debugging

| Symptom                               | Cause and fix                                                    |
| ------------------------------------- | ---------------------------------------------------------------- |
| Nothing arrives until the stream ends | Proxy buffering. Set `X-Accel-Buffering: no` and `no-transform`. |
| Messages never fire on the client     | Missing blank line after `data:`.                                |
| Connection drops every 30–60 seconds  | Idle timeout. Send keep-alive comments more often.               |
| Client reconnects in a tight loop     | The server closes immediately on connect, or returns a non-200.  |
| Messages lost across a reconnect      | No `id:` emitted, or `Last-Event-ID` ignored.                    |
| Only some clients receive events      | Multiple instances with no backplane.                            |
| Other requests to the origin stall    | HTTP/1.1 six-connection limit. Move to HTTP/2.                   |
| Server memory grows over time         | Subscriptions not released on disconnect.                        |
| Works in dev, dead behind the CDN     | The CDN is buffering or caching. Exclude the path.               |

```bash
curl -N -H "Accept: text/event-stream" https://api.example.com/events
```

`-N` disables curl's own buffering, which makes it the fastest way to confirm
whether the server or an intermediary is at fault.

---

## FAQ

**Is SSE obsolete now that WebSockets exist?**
No — it is more relevant than ever, largely because of LLM token streaming. For
one-way push it is simpler and more robust.

**Can I use SSE with POST?**
Not with `EventSource`, which only issues `GET`. Use `fetch` with a streaming
reader, which is what LLM clients do.

**How many concurrent streams can a server hold?**
Thousands on an async runtime; far fewer on thread-per-request. Each connection
costs a file descriptor and some memory.

**Does it work through corporate proxies?**
Usually better than WebSockets, since it is plain HTTP — but buffering proxies
can break it. The keep-alive comments and `no-transform` help.

**Can SSE send binary?**
No. Base64-encode it, or use WebSockets.

**What happens when the browser tab is backgrounded?**
The connection generally stays open, though mobile browsers may suspend it.
Reconnection with `Last-Event-ID` handles the resumption.

---

## Check your understanding

<Quiz
question="An SSE endpoint works locally but in production nothing reaches the browser until the stream ends. What is the most likely cause?"
options={[
{
text: 'nginx is buffering the proxied response — set X-Accel-Buffering: no and Cache-Control: no-transform',
correct: true,
why: 'nginx buffers proxied responses by default, so it accumulates output rather than forwarding each chunk. Locally there is no proxy, so it works.',
},
{text: 'The messages are missing their trailing blank line', why: 'That would break it locally too — the client would never dispatch anything at all.'},
{text: 'The browser does not support EventSource', why: 'Support is universal, and it would fail identically in development.'},
{text: 'The Content-Type header is wrong', why: 'A wrong content type breaks it everywhere, not only behind a proxy.'},
]}
explanation={<>Confirm with <code>curl -N</code> against the origin and again through the proxy: if the origin streams and the proxied URL does not, the intermediary is buffering. CDNs need the path excluded too.</>}
reference={{label: 'Server', href: '/knowledge-base/apis/server-sent-events#server'}}
/>

<Quiz
question="A dashboard using SSE loses updates whenever the network briefly drops, even though the browser reconnects. Why?"
options={[
{
text: 'The server never emits an id: field, so the client has no Last-Event-ID to send and the server cannot replay what was missed',
correct: true,
why: 'Automatic reconnection restores the stream but not the gap. Replay requires the server to emit ids and to honour Last-Event-ID on the reconnecting request.',
},
{text: 'EventSource does not reconnect automatically', why: 'It does — that is its main advantage over a raw WebSocket.'},
{text: 'The retry: interval is too long', why: 'It affects how quickly reconnection happens, not whether messages sent during the gap are recovered.'},
{text: 'Keep-alive comments are missing', why: 'Those prevent idle timeouts. They do not provide replay.'},
]}
explanation={<>Emit <code>id:</code> on every message and implement replay from <code>Last-Event-ID</code>. Together they give you an at-least-once recovery story that would be entirely hand-written with WebSockets.</>}
reference={{label: 'Client', href: '/knowledge-base/apis/server-sent-events#client'}}
/>

<Quiz
question="A team needs to send an Authorization header with their SSE connection. What are their options?"
type="multiple"
options={[
{text: 'Use fetch with a streaming body reader instead of EventSource', correct: true, why: 'Full header control, at the cost of implementing reconnection and partial-chunk buffering yourself.'},
{text: 'Use a library such as fetch-event-source that adds headers and reconnection', correct: true, why: 'Usually the right answer when you need both capabilities.'},
{text: 'Pass a short-lived token in the query string', correct: true, why: 'Works with EventSource everywhere. The token lands in access logs, so keep its lifetime short.'},
{text: 'Authenticate with cookies and withCredentials: true', correct: true, why: 'Simple and supported by EventSource, provided you account for CSRF.'},
{text: 'Set the header via the EventSource constructor options', why: 'EventSource has no header option — it accepts only a URL and withCredentials. This is its main limitation.'},
]}
explanation={<>The header restriction is the one real ergonomic gap in <code>EventSource</code>, and it is why LLM streaming clients almost all use the <code>fetch</code> approach.</>}
reference={{label: 'The EventSource limitations', href: '/knowledge-base/apis/server-sent-events#the-eventsource-limitations'}}
/>

<Quiz
question="An SSE endpoint is deployed on a PHP-FPM server with 20 workers. After 20 users open the dashboard, the whole site stops responding. Why?"
options={[
{
text: 'Each open stream occupies a worker for its entire lifetime, so 20 concurrent streams consume the whole pool',
correct: true,
why: 'Thread- or process-per-request models allocate a worker per connection. Long-lived connections are fundamentally incompatible with a small fixed pool.',
},
{text: 'PHP cannot produce text/event-stream responses', why: 'It can, with output flushing. The problem is the concurrency model, not the format.'},
{text: 'SSE requires HTTP/2, which PHP-FPM does not support', why: 'HTTP/2 helps with the browser connection limit; it does not change worker occupancy.'},
{text: 'The keep-alive comments are saturating the CPU', why: 'A few bytes every 15 seconds is negligible.'},
]}
explanation={<>Long-lived connections need an async runtime — Node, Go, or ASGI Python. On a thread-per-request stack, either move the streaming endpoint to a separate async service or fall back to polling.</>}
reference={{label: 'Scaling', href: '/knowledge-base/apis/server-sent-events#scaling'}}
/>

<Quiz
question="Which situation genuinely requires WebSockets rather than SSE?"
options={[
{
text: 'A collaborative editor where every keystroke is sent to the server and broadcast to other users',
correct: true,
why: 'High-frequency client-to-server messages over the same channel is exactly what SSE cannot do and what WebSockets exist for.',
},
{text: 'A dashboard showing live metrics updated every second', why: 'One-way server push — SSE, with automatic reconnection for free.'},
{text: 'Streaming an LLM response token by token', why: 'One-way server push, and the use case that made SSE mainstream again.'},
{text: 'Notifying a user when a background job completes', why: 'Infrequent one-way push. SSE, or even polling, is sufficient.'},
]}
explanation={<>The test is one question: does the client need to send frequently over the same channel? If not, SSE plus ordinary HTTP POST for actions is less code and less infrastructure.</>}
reference={{label: 'SSE, WebSockets or polling?', href: '/knowledge-base/apis/server-sent-events#sse-websockets-or-polling'}}
/>

---

## References

- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  — client API and format, with examples.
- [HTML Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
  — the normative specification, including `Last-Event-ID` semantics.
- [MDN: EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
  — including the `withCredentials` option and its limits.
- [fetch-event-source](https://github.com/Azure/fetch-event-source) — SSE over
  `fetch` with headers, POST and reconnection.
- [nginx proxy buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)
  — why `X-Accel-Buffering` matters.
- [OpenAI streaming](https://platform.openai.com/docs/api-reference/streaming) —
  the most widely copied SSE-over-POST implementation.
