---
title: 'OpenAPI'
description: 'Describing HTTP APIs in a machine-readable contract — the document structure, design-first vs code-first, generation, validation and governance.'
---

# OpenAPI

## Introduction

OpenAPI is a specification for describing an HTTP API in a machine-readable
document. One YAML or JSON file states every endpoint, parameter, request body,
response shape, status code and authentication scheme.

**The problem it solves.** API documentation written by hand goes stale
immediately. A field gets renamed, the docs do not, and a consumer wastes an
afternoon. Worse, every consumer hand-writes a client, and every team
hand-writes request validation and tests.

A machine-readable description gives you one artefact that generates
documentation, server stubs, client SDKs, mock servers, request validation
middleware and contract tests — all guaranteed consistent with each other,
because they come from the same source.

**Where it fits.** Any HTTP API with a consumer other than the team that wrote
it: public APIs, internal service-to-service contracts, and anything a mobile or
partner team integrates against.

:::note Versions
Written against **OpenAPI 3.2.0** (September 2025), which added hierarchical
tags, first-class streaming support (SSE, JSON Lines, multipart), custom HTTP
methods and the OAuth 2.0 Device Authorization Flow — **with no breaking changes
from 3.1**.

**OpenAPI 4.0 ("Project Moonwalk")** is still in design with no release date.
Use 3.x. The OpenAPI Initiative's own guidance says so explicitly.

3.1 aligned the schema language with **JSON Schema 2020-12**, which is the
version boundary that matters most: 3.0's schema dialect was a divergent subset,
and tooling written for it behaves differently.
:::

---

## The Document

```yaml
openapi: 3.2.0

info:
  title: Orders API
  version: 1.4.0
  description: Order management for the Acme storefront.
  contact: {name: API Team, email: api@example.com}
  license: {name: MIT, identifier: MIT}

servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://sandbox.api.example.com/v1
    description: Sandbox

security:
  - bearerAuth: [] # applied to every operation unless overridden

paths:
  /orders:
    get:
      operationId: listOrders # stable; generators use it for method names
      summary: List orders
      tags: [Orders]
      parameters:
        - name: status
          in: query
          schema: {$ref: '#/components/schemas/OrderStatus'}
        - name: limit
          in: query
          schema: {type: integer, minimum: 1, maximum: 100, default: 20}
        - name: cursor
          in: query
          schema: {type: string}
      responses:
        '200':
          description: A page of orders
          content:
            application/json:
              schema: {$ref: '#/components/schemas/OrderPage'}
        '401': {$ref: '#/components/responses/Unauthorized'}
        '429': {$ref: '#/components/responses/RateLimited'}

    post:
      operationId: createOrder
      summary: Create an order
      tags: [Orders]
      parameters:
        - name: Idempotency-Key
          in: header
          schema: {type: string, format: uuid}
      requestBody:
        required: true
        content:
          application/json:
            schema: {$ref: '#/components/schemas/CreateOrder'}
      responses:
        '201':
          description: Created
          headers:
            Location:
              schema: {type: string, format: uri}
          content:
            application/json:
              schema: {$ref: '#/components/schemas/Order'}
        '422': {$ref: '#/components/responses/ValidationError'}

  /orders/{orderId}:
    parameters:
      - name: orderId
        in: path
        required: true
        schema: {type: string, format: uuid}
    get:
      operationId: getOrder
      tags: [Orders]
      responses:
        '200':
          description: The order
          content:
            application/json:
              schema: {$ref: '#/components/schemas/Order'}
        '404': {$ref: '#/components/responses/NotFound'}

components:
  securitySchemes:
    bearerAuth: {type: http, scheme: bearer, bearerFormat: JWT}

  schemas:
    OrderStatus:
      type: string
      enum: [pending, paid, shipped, cancelled]

    Order:
      type: object
      required: [id, reference, status, totalPence, placedAt]
      properties:
        id: {type: string, format: uuid, readOnly: true}
        reference: {type: string, examples: ['ORD-1024']}
        status: {$ref: '#/components/schemas/OrderStatus'}
        totalPence: {type: integer, minimum: 0}
        placedAt: {type: string, format: date-time, readOnly: true}

    CreateOrder:
      type: object
      required: [productId, quantity]
      additionalProperties: false # reject unknown fields
      properties:
        productId: {type: string, format: uuid}
        quantity: {type: integer, minimum: 1, maximum: 100}

    OrderPage:
      type: object
      required: [data, page]
      properties:
        data: {type: array, items: {$ref: '#/components/schemas/Order'}}
        page:
          type: object
          properties:
            nextCursor: {type: string, nullable: true}
            hasMore: {type: boolean}

    Problem: # RFC 9457
      type: object
      properties:
        type: {type: string, format: uri}
        title: {type: string}
        status: {type: integer}
        detail: {type: string}

  responses:
    Unauthorized:
      description: Missing or invalid credentials
      content:
        application/problem+json:
          schema: {$ref: '#/components/schemas/Problem'}
    NotFound:
      description: Not found
      content:
        application/problem+json:
          schema: {$ref: '#/components/schemas/Problem'}
    ValidationError:
      description: Validation failed
      content:
        application/problem+json:
          schema: {$ref: '#/components/schemas/Problem'}
    RateLimited:
      description: Too many requests
      headers:
        Retry-After: {schema: {type: integer}}
      content:
        application/problem+json:
          schema: {$ref: '#/components/schemas/Problem'}
```

Details worth noticing:

- **`operationId` must be unique and stable.** Generators turn it into a method
  name, so renaming it breaks every generated client.
- **`$ref` everywhere.** Define a schema once in `components` and reference it.
  A description that repeats the same object inline five times will diverge.
- **Reusable responses.** `401`, `404`, `429` are identical across dozens of
  operations — define them once.
- **`readOnly: true`** marks server-generated fields, so generators exclude them
  from request types.
- **`additionalProperties: false`** rejects unknown fields. Useful for strictness
  on input; think carefully on output, where it prevents additive evolution.
- **`nullable`** does not exist in 3.1+. Use `type: [string, 'null']` — a
  JSON Schema 2020-12 alignment that catches people migrating from 3.0.

---

## Design-First or Code-First?

The central workflow decision.

**Design-first** — write the OpenAPI document, review it, then generate server
stubs and client SDKs from it.

- The API is designed deliberately, and reviewed before implementation exists.
- Frontend and backend can work in parallel against a mock server from day one.
- The contract is genuinely the source of truth.
- Requires discipline: it is tempting to change the code and update the document
  later, which is how it goes stale.

**Code-first** — annotate the implementation and generate the document from it.

- The description cannot drift, because it is derived from running code.
- Lower ceremony; nothing extra to maintain.
- API design becomes a by-product of implementation, which tends to leak
  internal structure into the public interface.

**Which to choose.** Design-first for a public API or a contract between teams,
where the interface is a product and deserves review. Code-first for an internal
API where the same team owns both sides — and frameworks make it nearly free:

```python
# FastAPI generates the whole document from type hints. No annotations needed.
@app.post("/orders", response_model=Order, status_code=201)
async def create_order(payload: CreateOrder) -> Order: ...
```

FastAPI, NestJS with decorators, Laravel with Scramble, and tRPC-to-OpenAPI all
produce a description from the implementation.

**The hybrid that works well:** design-first for the schemas and the shape,
code-first for keeping it honest — with a CI check that the generated document
matches the committed one.

---

## What You Get From It

```bash
# Documentation
npx @redocly/cli preview-docs openapi.yaml

# Typed client SDKs
npx openapi-typescript openapi.yaml -o src/api/schema.d.ts
npx @hey-api/openapi-ts -i openapi.yaml -o src/api

# A mock server, before the backend exists
npx @stoplight/prism-cli mock openapi.yaml

# Linting and style governance
npx @stoplight/spectral-cli lint openapi.yaml

# Contract testing against a running implementation
npx schemathesis run openapi.yaml --url https://sandbox.api.example.com
```

Two of these earn their place immediately.

**Typed clients** eliminate a whole category of integration bug. When the
description changes, `openapi-typescript` regenerates types and the consumer's
build fails at compile time rather than in production.

**Contract testing** with Schemathesis or Dredd generates requests from the
schema — including edge cases nobody wrote a test for — and checks the responses
conform. It routinely finds undocumented 500s.

**Request validation as middleware** is the other high-value use: validate
incoming requests against the same document that documents them, so the
description cannot be wrong without failing tests.

---

## Governance

An OpenAPI document that nobody enforces is just a file. **Spectral** lints it
against a ruleset, which is how you keep an API consistent across many teams:

```yaml title=".spectral.yaml"
extends: ['spectral:oas']

rules:
  operation-operationId: error
  operation-description: warn
  operation-tag-defined: error

  # Enforce house style
  paths-kebab-case:
    description: Paths must be kebab-case
    given: $.paths[*]~
    then: {function: pattern, functionOptions: {match: '^(/[a-z0-9-{}]+)+$'}}

  no-unversioned-server:
    given: $.servers[*].url
    then: {function: pattern, functionOptions: {match: '/v[0-9]+'}}
```

Run it in CI alongside a **breaking-change check** — `oasdiff` or Optic compares
the document against the previous version and fails the build on an
incompatible change:

```bash
oasdiff breaking main-openapi.yaml pr-openapi.yaml
```

This is the mechanism that turns "please do not break clients" from a request
into a rule.

---

## Common Mistakes

**Letting it drift from reality.** The most damaging one — a description that is
subtly wrong is worse than none, because consumers trust it. Fix it by
generating from code, or by validating requests and running contract tests
against the document in CI.

**Documenting only the happy path.** A description listing `200` and nothing
else forces every consumer to discover error shapes by trial. Document `401`,
`403`, `404`, `422`, `429` and `500`.

**No examples.** A schema tells you a field is a string; an example tells you it
looks like `ORD-1024`. Examples are what make generated documentation usable,
and 3.1+ uses `examples` (a list) rather than the singular `example`.

**Unstable `operationId`s.** Renaming one silently changes every generated
client's method name.

**Inline schemas everywhere.** The same object defined in twelve places will
disagree within a month. Use `$ref`.

**Using 3.0 idioms in 3.1+.** `nullable: true` and `example` were replaced.
Tooling may accept them silently and produce wrong output.

**Describing an API that should not exist.** OpenAPI documents the design; it
does not fix it. If the description is unpleasant to read, the API is unpleasant
to use.

---

## Do's and Don'ts

### Do

- Use OpenAPI 3.1 or 3.2, not 3.0 — the JSON Schema alignment matters.
- Give every operation a stable, unique `operationId`.
- Define schemas once in `components` and `$ref` them.
- Document every status code a client can receive.
- Include realistic examples on schemas and responses.
- Generate typed clients and let a schema change break the build.
- Lint with Spectral and check for breaking changes in CI.
- Version the document alongside the code it describes.

### Don't

- Don't hand-maintain a document beside code that can drift from it.
- Don't use `nullable: true` in 3.1+ — use a type array.
- Don't rename `operationId`s casually.
- Don't document only success responses.
- Don't set `additionalProperties: false` on responses if you want to add fields
  later.
- Don't wait for OpenAPI 4.0; it has no release date.
- Don't treat the description as documentation only — validate and test against
  it.

---

## Debugging

| Symptom                                  | Cause and fix                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Generated client has odd method names    | Missing or non-descriptive `operationId`.                                 |
| `nullable` ignored by tooling            | It was removed in 3.1. Use `type: [string, 'null']`.                      |
| Validation rejects a valid request       | `additionalProperties: false` with a field the client legitimately sends. |
| Docs show `{}` for a response            | The schema is missing or the `$ref` path is wrong.                        |
| Two schemas with the same name collide   | Duplicate `components.schemas` keys across merged files.                  |
| Contract tests fail on undocumented 500s | Real bugs — the API returns errors the description does not declare.      |
| Spectral passes locally, fails in CI     | Different ruleset or CLI version. Pin both.                               |
| Description and implementation disagree  | No CI check. Generate from code, or diff the two on every build.          |

---

## FAQ

**OpenAPI or Swagger?**
Same lineage. "Swagger" was the original name and now refers to SmartBear's
tooling (Swagger UI, Swagger Editor). The specification has been "OpenAPI" since
3.0.

**Should I wait for OpenAPI 4.0?**
No. Moonwalk is still in design with no date, and the OpenAPI Initiative
explicitly recommends using 3.x today.

**3.0, 3.1 or 3.2?**
3.1 at minimum, for full JSON Schema 2020-12 alignment. 3.2 if your tooling
supports it — it is additive over 3.1 with no breaking changes.

**Can I describe GraphQL with OpenAPI?**
No, and you should not try. GraphQL has its own schema and introspection. See
[GraphQL](/knowledge-base/apis/graphql).

**Does it work for webhooks?**
Yes — 3.1 added a top-level `webhooks` section for APIs that call _you_. See
[Webhooks](/knowledge-base/apis/webhooks).

**How do I document streaming responses?**
3.2 added first-class support for SSE, JSON Lines and multipart. Before that,
`text/event-stream` had to be described loosely as a string.

---

## Check your understanding

<Quiz
question="A team migrating a description from OpenAPI 3.0 to 3.1 finds that `nullable: true` is silently ignored. Why?"
options={[
{
text: 'OpenAPI 3.1 aligned with JSON Schema 2020-12, which has no nullable keyword — use a type array such as [string, "null"]',
correct: true,
why: '3.0 used a divergent subset of JSON Schema with its own nullable keyword. 3.1 adopted the standard dialect, where nullability is expressed as a union of types.',
},
{text: 'nullable was renamed to optional', why: 'Optionality (whether a key must be present) and nullability (whether its value may be null) are different concepts. Optionality is controlled by required.'},
{text: 'The tooling needs upgrading; nullable still works in 3.1', why: 'It was genuinely removed. Tooling that ignores it is behaving correctly.'},
{text: 'nullable only applies to response schemas in 3.1', why: 'It does not exist in 3.1 at all.'},
]}
explanation={<>This is the main reason to move past 3.0: the schema dialect is now standard JSON Schema, so the same schemas work with ordinary JSON Schema validators.</>}
reference={{label: 'The document', href: '/knowledge-base/apis/openapi#the-document'}}
/>

<Quiz
question="An OpenAPI document is maintained by hand alongside the implementation. Six months in, consumers report that documented fields do not exist. What is the most durable fix?"
options={[
{
text: 'Make the document enforceable — validate requests against it at runtime and run contract tests in CI, or generate it from the code',
correct: true,
why: 'Drift happens whenever the description is a separate artefact nobody is forced to update. Tying it to execution or to a failing build makes divergence impossible to ignore.',
},
{text: 'Assign a documentation owner to review it monthly', why: 'A social process against a mechanical problem. It degrades the moment that person is busy.'},
{text: 'Move the document into the same repository as the code', why: 'Helpful and necessary, but proximity alone does not prevent one changing without the other.'},
{text: 'Switch to writing documentation in Markdown instead', why: 'Removes the machine-readable benefits entirely and drifts just as fast.'},
]}
explanation={<>A subtly wrong description is worse than none, because consumers trust it. Schemathesis or Dredd against a running implementation catches divergence and routinely finds undocumented 500s as a bonus.</>}
reference={{label: 'Common mistakes', href: '/knowledge-base/apis/openapi#common-mistakes'}}
/>

<Quiz
question="Which of these does an accurate OpenAPI document give you beyond human-readable documentation?"
type="multiple"
options={[
{text: 'Typed client SDKs, so a schema change breaks the consumer build at compile time', correct: true, why: 'Regenerating types turns an integration bug into a type error before deployment.'},
{text: 'A mock server that frontend teams can develop against before the backend exists', correct: true, why: 'Prism and similar tools serve responses from the schema and examples, which is the main practical argument for design-first.'},
{text: 'Contract tests that generate requests from the schema and verify responses conform', correct: true, why: 'Schemathesis explores edge cases nobody wrote a test for.'},
{text: 'Request validation middleware driven by the same document', correct: true, why: 'The description cannot be wrong without failing tests, which is what keeps it honest.'},
{text: 'Automatic performance optimisation of the endpoints', why: 'OpenAPI describes an interface. It has no bearing on implementation performance.'},
]}
explanation={<>The value compounds: one artefact drives docs, clients, mocks, validation and tests, all guaranteed mutually consistent because they derive from the same source.</>}
reference={{label: 'What you get from it', href: '/knowledge-base/apis/openapi#what-you-get-from-it'}}
/>

<Quiz
question="A team renames an `operationId` from `getOrder` to `fetchOrder` for consistency. What breaks?"
options={[
{
text: 'Every generated client SDK — the operationId becomes the method name, so consumers calling getOrder() no longer compile',
correct: true,
why: 'operationId is a stable identifier for tooling, not a display label. Renaming it is a breaking change for anyone using a generated client.',
},
{text: 'Nothing — operationId is only used for documentation headings', why: 'Generators use it directly for method and type names.'},
{text: 'The endpoint URL changes', why: 'The path is independent of operationId.'},
{text: 'Only the Spectral lint rules', why: 'Linting checks that it exists and is unique; it cannot know consumers depend on the old name.'},
]}
explanation={<>Treat <code>operationId</code> with the same care as a published function name. Use <code>summary</code> and <code>description</code> for human-facing wording, which you can reword freely.</>}
reference={{label: 'The document', href: '/knowledge-base/apis/openapi#the-document'}}
/>

<Quiz
question="A public API is being designed by three teams and consistency is slipping — different pagination parameters, inconsistent path casing, missing error responses. What addresses this?"
options={[
{
text: 'Spectral linting with a house ruleset in CI, plus an oasdiff breaking-change check on every pull request',
correct: true,
why: 'Turns style and compatibility from review opinions into build failures. This is the mechanism that scales API governance beyond one team.',
},
{text: 'A written style guide circulated to all three teams', why: 'Necessary as the source of the rules, and unenforced documents lose to deadlines.'},
{text: 'A single architect reviewing every pull request', why: 'A bottleneck, and inconsistent by nature. Encode the rules instead.'},
{text: 'Switching to GraphQL, which has a single schema', why: 'A single schema does not enforce naming or error consistency, and it is a very large change to solve a governance problem.'},
]}
explanation={<>Custom Spectral rules can encode almost any house convention — path casing, required error responses, versioned server URLs, mandatory examples — and they run in seconds.</>}
reference={{label: 'Governance', href: '/knowledge-base/apis/openapi#governance'}}
/>

---

## References

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html) — the
  normative document.
- [OpenAPI Initiative](https://www.openapis.org/) — releases, and the Moonwalk
  status updates.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/release-notes) —
  the dialect 3.1+ uses.
- [Spectral](https://stoplight.io/open-source/spectral) — linting and custom
  governance rules.
- [oasdiff](https://github.com/oasdiff/oasdiff) — breaking-change detection.
- [Schemathesis](https://schemathesis.readthedocs.io/) — property-based contract
  testing from a description.
- [openapi-typescript](https://openapi-ts.dev/) — generate TypeScript types from
  a document.
