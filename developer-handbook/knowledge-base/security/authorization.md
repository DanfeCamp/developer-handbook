---
title: 'Authorization'
description: 'Deciding what an authenticated user may do — RBAC, ABAC and ReBAC, object-level checks, multi-tenancy, and the number one vulnerability on the OWASP list.'
---

# Authorization

## Introduction

Authorisation answers **"what may you do?"**. It runs after
[authentication](/knowledge-base/security/authentication), which answers "who
are you?".

**This is the most exploited category of web vulnerability.** Broken Access
Control is **A01 in the OWASP Top 10:2025**, as it was in 2021 — and the 2025
revision folded SSRF into it, widening the category further. It is not an exotic
attack: it is usually changing an id in a URL.

```http
GET /api/invoices/1024   ← your invoice
GET /api/invoices/1025   ← someone else's, returned happily
```

**Why it is so common.** Authentication is a single, visible feature you build
once. Authorisation is a decision that must be made correctly at **every
endpoint, every query and every field**, forever, including in code written next
year by someone who has not read this page. One missed check is a breach.

**The rule everything else supports:** authorisation is decided on the server,
per request, against the specific resource. Anything decided by the client — a
hidden field, a JavaScript route guard, an unrendered button — is decoration.

---

## Models

### RBAC — role-based

Permissions attach to roles; users get roles. The most common model, and
sufficient for a great many applications.

```ts
const permissions = {
  admin: ['order:read', 'order:write', 'order:delete', 'user:manage'],
  support: ['order:read', 'order:refund'],
  customer: ['order:read:own', 'order:create'],
} as const;
```

**Where it strains:** anything conditional. "Support may refund, but only under
£100, only within 30 days, and only in their own region" cannot be expressed as
a role without inventing `support_uk_junior_limited`. Role explosion is the
symptom that you have outgrown pure RBAC.

### ABAC — attribute-based

Decisions are computed from attributes of the user, the resource, the action and
the context.

```ts
function canRefund(user: User, order: Order, now: Date): boolean {
  return (
    user.permissions.includes('order:refund') &&
    order.totalPence <= user.refundLimitPence &&
    daysBetween(order.placedAt, now) <= 30 &&
    order.region === user.region
  );
}
```

Far more expressive, and harder to audit — "who can refund this order?" is no
longer a table lookup but the result of evaluating a function.

### ReBAC — relationship-based

Permissions derive from relationships in a graph: _you may edit this document
because you are an editor of the folder that contains it._ This is Google Docs
and GitHub's model, formalised in Google's Zanzibar paper and available as
OpenFGA, SpiceDB and Ory Keto.

Worth reaching for when permissions are inherited through hierarchies or
sharing, which is genuinely painful in RBAC.

**Most applications need RBAC plus a few attribute checks.** Start there, and
adopt a dedicated system when the conditional logic becomes unmanageable.

---

## Object-Level Authorisation

The single most important section on this page.

Route-level checks answer "may this _kind_ of user call this endpoint?" They
cannot answer "may _this_ user touch _that_ record?"

```ts
// ❌ Authenticated, and completely broken.
router.get('/api/orders/:id', requireAuth, async (req, res) => {
  const order = await db.order.findUnique({where: {id: req.params.id}});
  res.json(order);   // any logged-in user can read any order
});

// ✅ The ownership check is the security control.
router.get('/api/orders/:id', requireAuth, async (req, res) => {
  const order = await db.order.findUnique({where: {id: req.params.id}});

  if (!order || !can(req.user, 'read', order)) {
    return res.status(404).json({error: 'Not found'});
  }
  res.json(order);
});
```

**Return 404 rather than 403** for a resource the user may not access. A 403
confirms the record exists, which lets an attacker enumerate valid ids and
measure the size of your business.

### Filter in the query, not after it

Even better than checking after loading: never load what the user cannot see.

```ts
// ❌ Loads everything, filters in memory — one forgotten filter is a leak
const orders = await db.order.findMany();
return orders.filter((o) => o.userId === user.id);

// ✅ The database enforces it
const orders = await db.order.findMany({where: {userId: user.id}});
```

The second form cannot leak by accident, and it does not transfer other users'
data into your process memory where a logging statement might capture it.

**Row-level security** pushes this into the database, so a forgotten `WHERE`
clause cannot leak anything:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id')::bigint);
```

For multi-tenant applications this is the strongest control available, because
it holds for every query including ad-hoc ones. See
[PostgreSQL](/knowledge-base/databases/postgresql#security).

### Mass assignment

An authorisation bug that hides in a data-binding convenience:

```ts
// ❌ The user submits {"name": "Ada", "role": "admin"} and becomes an admin
await db.user.update({where: {id}, data: req.body});

// ✅ Allowlist the fields a user may set about themselves
const {name, avatarUrl} = UpdateProfileSchema.parse(req.body);
await db.user.update({where: {id}, data: {name, avatarUrl}});
```

Never bind a request body straight into a model. Parse it into an explicit
shape, and keep privileged fields — `role`, `isAdmin`, `accountId`,
`creditBalance` — out of any user-facing schema.

---

## Where to Put the Check

Authorisation should be **as close to the data as possible**, and enforced in
depth.

| Layer                | Good for                          | Never sufficient alone           |
| -------------------- | --------------------------------- | -------------------------------- |
| UI                   | Hiding what the user cannot do    | ✅ Trivially bypassed            |
| Gateway / middleware | Coarse route protection           | ✅ Cannot see the resource       |
| Controller           | Route-level roles                 | ✅ Easy to forget on a new route |
| **Service / domain** | **The real decision**             | Preferred home                   |
| **Database (RLS)**   | **Backstop for tenant isolation** | Strongest, most limited          |

**The UI is not a control.** Hiding a delete button is good UX and no security
at all — the endpoint is still there.

**Middleware is not enough.** It can confirm a session exists and a role
matches. It cannot know whether this user owns order 1024, and a matcher pattern
that misses a new route removes all protection silently. See
[Next.js proxy.ts](/knowledge-base/next-js/api-routes#proxyts).

**Deny by default.** New endpoints should be inaccessible until explicitly
opened, not open until someone remembers to protect them. Where your framework
allows a global "authenticate everything" default with explicit opt-outs, use
it.

### A policy layer

Centralise the decisions rather than scattering `if` statements:

```ts
export const orderPolicy = {
  read: (user: User, order: Order) =>
    user.id === order.userId || user.roles.includes('support'),

  refund: (user: User, order: Order, now: Date) =>
    user.permissions.includes('order:refund') &&
    order.totalPence <= user.refundLimitPence &&
    daysBetween(order.placedAt, now) <= 30,
};
```

The value is that the rules are in one place, unit-testable without HTTP, and
reviewable as a set. Laravel policies, Django permissions, Pundit and CASL all
provide a version of this; a plain object works fine.

For larger systems, an external engine — Open Policy Agent, Cedar, OpenFGA —
keeps policy out of application code and makes it auditable, at the cost of
another system to operate.

---

## Multi-Tenancy

Where authorisation failures are most damaging, because the blast radius is
another customer's entire dataset.

**Every query must be scoped by tenant.** The question is what enforces it.

1. **Application-level scoping** — every query includes `tenantId`. Works, and
   depends on nobody ever forgetting.
2. **Row-level security** — the database enforces it. One forgotten `WHERE`
   cannot leak.
3. **Schema or database per tenant** — the strongest isolation, and the most
   operational overhead.

**Set the tenant once per request**, from the session — never from a header, a
query parameter or the request body, all of which the client controls:

```ts
// ❌ The client chooses their tenant
const tenantId = req.headers['x-tenant-id'];

// ✅ Derived from the authenticated session
const tenantId = req.session.tenantId;
```

**Test cross-tenant access explicitly.** A test asserting that tenant A gets 404
for tenant B's record is worth more than most happy-path tests, and it is the
one that catches a regression before a customer does.

---

## Common Mistakes

**Only checking authentication.** The endpoint verifies a session exists and
never asks whether this user may touch this record. This is A01, and it is the
single most common serious web vulnerability.

**Trusting client-supplied identifiers.** `userId` from a request body,
`tenantId` from a header, a role from an unverified JWT claim.

**Insecure direct object references.** Predictable ids plus no ownership check.
UUIDs make guessing harder and are not a substitute for the check.

**Mass assignment.** Binding a request body into a model and letting a user set
their own role.

**Authorising in the UI only.** The endpoint remains open.

**Forgetting new endpoints.** Deny by default so an unprotected route fails
rather than leaks.

**Missing checks on writes.** Read paths get scrutiny; `PATCH` and `DELETE` are
sometimes overlooked entirely.

**Ignoring indirect access.** A user may not read an order, but an export
endpoint, a search index, a webhook payload or an admin report includes it.

**403 instead of 404.** Confirms existence and enables enumeration.

---

## Testing

Authorisation is one of the few areas where **negative tests matter more than
positive ones**.

```ts
describe('GET /api/orders/:id', () => {
  it('returns the order to its owner', async () => {
    await request(app).get(`/api/orders/${order.id}`)
      .set(authHeader(owner)).expect(200);
  });

  it('returns 404 to a different user', async () => {
    await request(app).get(`/api/orders/${order.id}`)
      .set(authHeader(otherUser)).expect(404);   // not 403
  });

  it('returns 401 when unauthenticated', async () => {
    await request(app).get(`/api/orders/${order.id}`).expect(401);
  });

  it('does not allow a user to change their own role', async () => {
    await request(app).patch('/api/me')
      .set(authHeader(user)).send({role: 'admin'}).expect(422);

    expect((await db.user.findUnique({where: {id: user.id}})).role).toBe('customer');
  });
});
```

Write these as a reusable matrix — for each endpoint: owner, other user,
other tenant, anonymous, and elevated role. Automated route enumeration that
fails when a new endpoint has no authorisation test is even better.

---

## Do's and Don'ts

### Do

- Check authorisation per object, not just per route.
- Filter by owner or tenant **in the query**.
- Use row-level security for multi-tenant isolation.
- Deny by default; require an explicit opt-out for public routes.
- Centralise rules in a policy layer and unit-test them.
- Derive tenant and user identity from the session only.
- Allowlist fields on every write.
- Return 404 rather than 403 for resources the user may not see.
- Write negative tests for every endpoint.

### Don't

- Don't rely on middleware or the UI as the only control.
- Don't trust ids, roles or tenant identifiers from the client.
- Don't bind request bodies directly into models.
- Don't assume UUIDs provide access control.
- Don't scatter authorisation logic across controllers.
- Don't forget writes, exports, search results and admin views.
- Don't confirm existence to users who may not access a record.

---

## FAQ

**RBAC or ABAC?**
RBAC until roles start multiplying to encode conditions. Then add attribute
checks within your policy layer, rather than inventing more roles.

**Where should the check live?**
In the service or domain layer, close to the data, with row-level security as a
backstop. Controllers and middleware are supplementary.

**Do UUIDs remove the need for ownership checks?**
No. They make ids hard to guess, which is obscurity, not authorisation. Leaked
or shared ids still work.

**403 or 404?**
404 for resources the user should not know exist; 403 when the existence is not
sensitive and a clear message helps. Be consistent within an API.

**How do I authorise across microservices?**
Validate at the edge and propagate a signed token containing the identity and
claims. Each service still authorises its own resources — never trust a caller
because it is internal. See
[Microservices](/knowledge-base/architecture/microservices).

**Do I need OPA or OpenFGA?**
Only when policy is complex enough to deserve its own system, or must be
auditable independently. A policy module in your codebase covers most
applications.

---

## Check your understanding

<Quiz
question="An endpoint requires a valid session, then loads an invoice by the id in the URL and returns it. A tester finds that changing the id returns other customers' invoices. What is the flaw called, and why is it so common?"
options={[
{
text: 'Broken object-level authorisation — the code proves who the user is but never checks whether this user may access this record. It is common because the check must be repeated at every endpoint, forever',
correct: true,
why: 'Authentication is one feature built once; authorisation is a decision required at every endpoint and every query. One omission is a breach, which is why it is A01 in the OWASP Top 10.',
},
{text: 'Session fixation', why: 'That is reusing a pre-login session id. Unrelated to per-record access.'},
{text: 'Insecure deserialisation', why: 'That concerns untrusted serialised objects, not access checks.'},
{text: 'Not a flaw — the session requirement is sufficient', why: 'A valid session proves identity only. It says nothing about entitlement to a specific record.'},
]}
explanation={<>Two structural mitigations beat remembering: filter by owner in the query itself (<code>where: &#123;userId: user.id&#125;</code>) so the record is never loaded, and enable row-level security so the database refuses regardless of what the application asks for.</>}
reference={{label: 'Object-level authorisation', href: '/knowledge-base/security/authorization#object-level-authorisation'}}
/>

<Quiz
question="A profile endpoint does `db.user.update({where: {id}, data: req.body})`. What can a user do?"
options={[
{
text: 'Set any column the model exposes — including role or isAdmin — by adding it to the request body',
correct: true,
why: 'Mass assignment. The request body is bound straight into the update, so the user chooses which fields to write, not just their values.',
},
{text: 'Nothing, since the where clause restricts it to their own record', why: 'The where clause controls which row is updated. It does nothing about which columns the user may set on that row.'},
{text: 'Only cause a validation error for unknown fields', why: 'Most ORMs accept any valid column. Nothing rejects role unless you do.'},
{text: 'Trigger a SQL injection', why: 'The ORM parameterises values. This is an authorisation flaw, not an injection one.'},
]}
explanation={<>Parse into an explicit shape and destructure the fields you intend to allow. Privileged columns — <code>role</code>, <code>tenantId</code>, <code>creditBalance</code> — must never appear in a user-facing schema.</>}
reference={{label: 'Mass assignment', href: '/knowledge-base/security/authorization#mass-assignment'}}
/>

<Quiz
question="Which measures provide genuine authorisation enforcement?"
type="multiple"
options={[
{text: 'Filtering by owner or tenant inside the database query', correct: true, why: 'The record is never loaded, so it cannot leak through a later mistake or a log line.'},
{text: 'PostgreSQL row-level security scoped to the current tenant', correct: true, why: 'The database enforces it for every query, including ad-hoc ones and ones written next year.'},
{text: 'A policy layer consulted in the service before returning a resource', correct: true, why: 'Centralised, unit-testable rules close to the data.'},
{text: 'Hiding the delete button for users without permission', why: 'Good UX and zero security — the endpoint is unchanged and reachable directly.'},
{text: 'Using UUID primary keys so ids cannot be guessed', why: 'Obscurity. A leaked, shared or logged id still works, because no check was added.'},
]}
explanation={<>Defence in depth: the query filter prevents the common case, row-level security catches the forgotten one, and the policy layer keeps the rules reviewable in one place.</>}
reference={{label: 'Where to put the check', href: '/knowledge-base/security/authorization#where-to-put-the-check'}}
/>

<Quiz
question="A multi-tenant API reads the tenant from an X-Tenant-Id header supplied by the client. What is wrong?"
options={[
{
text: 'The client controls the header, so any user can read another tenant\'s data by changing it — tenant identity must come from the authenticated session',
correct: true,
why: 'Anything the client sends is attacker-controlled input. Tenant scope is a security boundary and must be derived server-side from the session or token.',
},
{text: 'Headers are not a reliable transport for identifiers', why: 'Headers are fine as a transport. The problem is who decides the value.'},
{text: 'It only matters if the header is not validated as a UUID', why: 'A well-formed UUID belonging to another tenant is exactly the attack.'},
{text: 'Nothing, provided the gateway sets the header', why: 'That would be acceptable — but only if the gateway derives it from a verified session and strips any client-supplied value.'},
]}
explanation={<>Write the negative test: authenticate as tenant A, request tenant B's record, assert 404. It is the single most valuable test in a multi-tenant system.</>}
reference={{label: 'Multi-tenancy', href: '/knowledge-base/security/authorization#multi-tenancy'}}
/>

<Quiz
question="A team's roles have grown to support_uk_junior, support_uk_senior, support_eu_junior and six more variants. What does this indicate?"
options={[
{
text: 'Role explosion — conditions like region and refund limit are being encoded as roles. These are attributes, and belong in policy conditions rather than in role names',
correct: true,
why: 'Pure RBAC cannot express conditional rules, so teams multiply roles to encode them. Adding attribute checks within a policy layer collapses the combinations.',
},
{text: 'The team should switch entirely to ReBAC', why: 'ReBAC suits permissions inherited through hierarchies and sharing. This is conditional, attribute-driven logic.'},
{text: 'Roles should always be this granular for auditability', why: 'It makes auditing harder — nobody can say what any given role actually permits.'},
{text: 'They need a separate role-management microservice', why: 'A structural modelling problem is not solved by relocating it.'},
]}
explanation={<>The usual endpoint is RBAC for the coarse grant plus attribute conditions for the qualifiers — <code>hasPermission('order:refund') &amp;&amp; amount &lt;= limit &amp;&amp; region matches</code> — kept in one testable policy module.</>}
reference={{label: 'Models', href: '/knowledge-base/security/authorization#models'}}
/>

---

## References

- [OWASP Top 10:2025 — A01 Broken Access Control](https://owasp.org/Top10/2025/)
  — the current list, with SSRF now folded into this category.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
  — practical guidance and anti-patterns.
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  — BOLA and BFLA, the API-specific forms.
- [Google Zanzibar](https://research.google/pubs/pub48190/) — the paper behind
  relationship-based authorisation.
- [OpenFGA](https://openfga.dev/) and [Open Policy Agent](https://www.openpolicyagent.org/)
  — external policy engines.
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
  — database-enforced isolation.
