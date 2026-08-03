---
title: 'SQL Injection'
description: 'Why string-built queries remain dangerous — parameterisation, the parts that cannot be parameterised, ORM escape hatches, blind injection and defence in depth.'
---

# SQL Injection

## Introduction

SQL injection happens when user input is concatenated into a query, so the
database interprets part of that input as **SQL syntax** rather than as data.

```python
# The vulnerable pattern, in every language
query = "SELECT * FROM users WHERE email = '" + email + "'"
```

Supply `' OR '1'='1` and the database receives:

```sql
SELECT * FROM users WHERE email = '' OR '1'='1'
```

Every row is returned. With a little more effort an attacker reads other tables,
modifies data, or — where the database user has sufficient privileges — reads
files from the host.

**It has been the best-understood vulnerability in software for twenty-five
years and it is still found constantly.** The reason is not ignorance of the
fix; it is that string concatenation is the path of least resistance in every
language, and one query written in a hurry is enough.

**The fix is complete and simple.** Parameterised queries eliminate the entire
class — not mitigate, eliminate — because the query structure is sent to the
database separately from the values. There is no escaping to get right and no
edge case to miss.

The rest of this page is about the places that fix does not reach.

---

## Parameterised Queries

The data never becomes part of the SQL statement. The database parses the query
first, then binds the values as opaque data.

```ts
// ✅ Node — pg
await db.query('SELECT * FROM users WHERE email = $1 AND active = $2', [email, true]);

// ✅ Node — mysql2 (use execute, which prepares)
await conn.execute('SELECT * FROM users WHERE email = ?', [email]);
```

```php
// ✅ PHP — PDO
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);
```

```python
# ✅ Python — DB-API. Note the comma: this is a parameter tuple, not string formatting
cursor.execute('SELECT * FROM users WHERE email = %s', (email,))
```

```java
// ✅ Java — JDBC
var stmt = conn.prepareStatement("SELECT * FROM users WHERE email = ?");
stmt.setString(1, email);
```

**Why it is airtight:** `' OR '1'='1` bound as a parameter is searched for as a
literal email address containing quotes. It is never parsed as SQL, because
parsing already happened.

**Do not confuse parameterisation with escaping.** Escaping functions such as
`mysql_real_escape_string` depend on correct character-set configuration and
have been bypassed in practice. Parameterisation has no such failure mode.

---

## What Cannot Be Parameterised

The important limitation, and the source of most surviving vulnerabilities in
otherwise careful codebases.

**Only values can be parameters.** Table names, column names, sort direction and
`LIMIT` in some drivers are part of the query _structure_, and structure cannot
be bound.

```ts
// ❌ Does not work — and people then fall back to concatenation
db.query('SELECT * FROM users ORDER BY $1 $2', [column, direction]);
```

**Use an allowlist.** Never sanitise a column name; map it:

```ts
const SORTABLE = {
  created: 'created_at',
  name: 'full_name',
  total: 'total_pence',
} as const;

function buildQuery(sortKey: string, dir: string) {
  const column = SORTABLE[sortKey as keyof typeof SORTABLE];
  if (!column) throw new BadRequest('Invalid sort field');

  const direction = dir === 'desc' ? 'DESC' : 'ASC'; // never interpolate the input

  return `SELECT * FROM orders ORDER BY ${column} ${direction}`;
}
```

The user's input selects from a fixed set; it never reaches the SQL. Anything
outside the set is rejected rather than cleaned.

The same applies to dynamic `IN` clauses — generate the right number of
placeholders rather than joining the values:

```ts
const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
await db.query(`SELECT * FROM orders WHERE id IN (${placeholders})`, ids);
```

---

## ORMs and Their Escape Hatches

ORMs parameterise by default, which is why they have removed most SQL injection
from modern applications. **The vulnerabilities live in the raw-query escape
hatches**, which every ORM provides.

```ts
// ❌ Prisma — template interpolation into raw SQL
await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${email}'`);

// ✅ Prisma — the tagged template parameterises automatically
await prisma.$queryRaw`SELECT * FROM users WHERE email = ${email}`;
```

```php
// ❌ Laravel — concatenation into whereRaw
User::whereRaw("email = '$email'")->get();

// ✅ Bindings
User::whereRaw('email = ?', [$email])->get();
```

```python
# ❌ Django — string formatting into extra/raw
User.objects.raw(f"SELECT * FROM users WHERE email = '{email}'")

# ✅ Params
User.objects.raw('SELECT * FROM users WHERE email = %s', [email])
```

**Grep your codebase** for `queryRaw`, `$queryRawUnsafe`, `whereRaw`,
`DB::raw`, `.raw(`, `execute(f"` and string concatenation near `SELECT`. The
list of raw-query call sites in a typical application is short, and each one
either has bindings or is a finding.

**`orderBy` from user input** deserves specific attention: several ORMs will
happily interpolate a column name you pass through from a query parameter.

---

## Beyond the Obvious

**Second-order injection.** Input is stored safely, then concatenated into a
query later. The insert was parameterised; the subsequent read was not. Data
from your own database is still untrusted for query construction.

**Injection in `LIKE` patterns.** Parameterisation prevents SQL injection but not
wildcard abuse — a user searching for `%` matches everything, which can be a
denial-of-service on a large table. Escape `%` and `_` in the value.

**JSON path injection** in `jsonb` queries, and similar in stored procedures that
build dynamic SQL internally. A parameterised call to a procedure that
concatenates inside itself is still vulnerable.

**NoSQL injection.** The same class, different syntax. See
[MongoDB](/knowledge-base/databases/mongodb#security) — a JSON body supplying
`{"$ne": null}` where a string was expected matches every document.

**Blind SQL injection.** The response contains no data and no error, so the
attacker infers content one bit at a time — through boolean differences in the
response, or by timing:

```sql
' OR (SELECT CASE WHEN (SELECT substring(password,1,1) FROM users LIMIT 1)='a'
      THEN pg_sleep(5) ELSE pg_sleep(0) END)--
```

If the response takes five seconds, the first character is `a`. This is slow and
entirely automated by tools like sqlmap. **Suppressing error messages is not a
fix.**

---

## Defence in Depth

Parameterisation is the fix. These limit the damage if something is missed.

**Least privilege.** The application's database user needs `SELECT`, `INSERT`,
`UPDATE` and `DELETE` on its own tables — not `DROP`, not `CREATE`, not
superuser, and not read access to other schemas. Run migrations as a different,
higher-privileged user.

```sql
CREATE USER app_user WITH PASSWORD '…';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
REVOKE CREATE ON SCHEMA public FROM app_user;
```

**Validate input at the boundary.** Not as an injection defence — parameterisation
handles that — but because a `quantity` that must be a positive integer should
never reach the database as a string at all.

**Never return database errors to clients.** `ERROR: column "x" does not exist`
is a free schema map for an attacker. Log it with a correlation id; return a
generic message. This is now explicitly its own OWASP category —
**A10:2025 Mishandling of Exceptional Conditions**.

**Row-level security** as a backstop, so even a successful injection is scoped to
one tenant. See
[PostgreSQL](/knowledge-base/databases/postgresql#security).

**A WAF** catches common payloads and is trivially bypassed by an attacker who is
paying attention. Useful as a speed bump and as a source of alerts; never as the
control.

**Monitor and alert.** A sudden spike in database errors, or queries returning
far more rows than usual, is often the first visible sign.

---

## Testing

```ts
it('treats injection payloads as literal search terms', async () => {
  await createUser({email: 'real@example.com'});

  const results = await searchUsers("' OR '1'='1");

  expect(results).toHaveLength(0); // not "every user"
});

it('rejects an unknown sort column', async () => {
  await request(app)
    .get('/api/orders?sort=(SELECT+1)')
    .set(authHeader)
    .expect(400);
});
```

Beyond unit tests:

- **Static analysis.** `eslint-plugin-security`, Semgrep rules, CodeQL and
  Larastan all detect concatenation into query calls.
- **`sqlmap`** against a staging environment, with authorisation.
- **Code review focused on raw-query call sites** — a short, greppable list.
- **Log slow and failing queries**; blind injection is slow and noisy.

---

## Do's and Don'ts

### Do

- Parameterise every query with a variable in it.
- Use an allowlist for table names, column names and sort direction.
- Generate placeholders for `IN` clauses rather than joining values.
- Use the ORM's binding form in raw queries.
- Grant the application database user the minimum privileges it needs.
- Return generic error messages and log the detail with a correlation id.
- Escape `%` and `_` in `LIKE` patterns.
- Treat data from your own database as untrusted when building queries.

### Don't

- Don't concatenate or interpolate anything into SQL.
- Don't rely on escaping functions instead of parameters.
- Don't trust an ORM blindly — audit its raw-query escape hatches.
- Don't pass user input into `orderBy` without an allowlist.
- Don't run the application as a database superuser.
- Don't expose database errors to clients.
- Don't treat a WAF as the fix.
- Don't assume stored procedures are inherently safe.

---

## Common Mistakes

**"We use an ORM, so we are safe."** True until someone writes a raw query for a
report, which they will.

**Escaping instead of parameterising.** Character-set dependent, and bypassed in
practice.

**Allowlisting values but not identifiers.** The sort column is the classic
missed spot.

**Second-order injection.** Parameterising the write and concatenating the read.

**Suppressing errors and calling it fixed.** Blind injection works without any
error output.

**Sanitising by stripping keywords.** Removing `SELECT` and `UNION` is a
blocklist, and blocklists lose. `SESELECTLECT` survives naive stripping.

**Application user with `DROP`.** Turns a data breach into data destruction.

---

## Debugging

| Symptom                                           | Cause and fix                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Query works until an apostrophe appears in a name | String concatenation. Parameterise — this is the diagnostic symptom.     |
| "Syntax error near ..." with unusual input        | Input is being parsed as SQL.                                            |
| Sort parameter breaks the query                   | Column name interpolated. Use an allowlist.                              |
| `IN` clause fails with a list                     | Values joined into one placeholder. Generate one placeholder per value.  |
| Prisma `$queryRaw` still injectable               | `$queryRawUnsafe` was used, or the template was built as a string first. |
| Unexplained slow queries in logs                  | Possible blind time-based injection. Inspect the parameters.             |
| ORM query fine, report query vulnerable           | The raw-query escape hatch. Grep for it.                                 |

**A useful canary:** if a legitimate apostrophe in a surname (`O'Brien`) breaks a
query, that query is being built by concatenation and is injectable. It is the
cheapest test there is.

---

## FAQ

**Does an ORM make me immune?**
It removes the common case. Raw queries, `whereRaw`, `$queryRawUnsafe` and
dynamic `orderBy` remain, and that is where injection now lives.

**Are prepared statements slower?**
No — often faster, because the database can cache the execution plan.

**How do I handle a dynamic `WHERE` clause?**
Build the structure from an allowlist of conditions and bind all values:
`conditions.push('status = $1')` with parameters accumulated alongside.

**Is `LIMIT` parameterisable?**
In most drivers yes. Where it is not, validate it as a bounded integer before
interpolating.

**Do stored procedures prevent injection?**
Only if they do not build dynamic SQL internally. Many do, and are vulnerable
despite being called with parameters.

**What about NoSQL?**
Same class, different syntax — operator injection rather than SQL. Validate
input types before they reach a query. See
[MongoDB](/knowledge-base/databases/mongodb#security).

---

## Check your understanding

<Quiz
question="A codebase uses Prisma throughout. A reviewer says SQL injection is impossible. Where should you look?"
options={[
{
text: 'The raw-query escape hatches — $queryRawUnsafe, and $queryRaw where the SQL was built as a string before being passed',
correct: true,
why: 'ORMs parameterise their query builders, so injection migrates to the raw escape hatches every ORM provides. The tagged-template form is safe; the Unsafe variant and pre-built strings are not.',
},
{text: 'Nowhere — Prisma parameterises everything', why: 'It parameterises the query builder. It cannot parameterise SQL you assembled yourself and handed it.'},
{text: 'Only the migration files', why: 'Migrations run trusted developer-authored SQL, not user input.'},
{text: 'The connection string configuration', why: 'A credentials concern, not an injection surface.'},
]}
explanation={<>Also check dynamic <code>orderBy</code>: several ORMs will interpolate a column name passed straight from a query parameter, and column names cannot be parameterised.</>}
reference={{label: 'ORMs and their escape hatches', href: '/knowledge-base/security/sql-injection#orms-and-their-escape-hatches'}}
/>

<Quiz
question="An endpoint accepts ?sort=created_at&dir=desc and needs to order by that column. Parameterisation does not work. What is correct?"
options={[
{
text: 'Map the input through a fixed allowlist of permitted columns and directions, rejecting anything else',
correct: true,
why: 'Column names and sort direction are query structure, not values, so they cannot be bound. An allowlist means user input selects from a fixed set rather than reaching the SQL.',
},
{text: 'Escape the column name before interpolating it', why: 'Escaping is for values. There is no reliable escaping for an identifier, and this is precisely where injection survives in careful codebases.'},
{text: 'Strip SQL keywords from the parameter', why: 'A blocklist, and blocklists lose — nested and encoded variants get through.'},
{text: 'Use a prepared statement with the column as a parameter', why: 'Drivers reject this: the query is parsed before values are bound, so the structure must already be fixed.'},
]}
explanation={<>The same applies to table names and, in some drivers, <code>LIMIT</code>. Where a value genuinely cannot be bound, validate it into a known-safe set rather than trying to clean it.</>}
reference={{label: 'What cannot be parameterised', href: '/knowledge-base/security/sql-injection#what-cannot-be-parameterised'}}
/>

<Quiz
question="A team removes detailed database errors from responses and considers SQL injection mitigated. Are they?"
options={[
{
text: 'No — blind SQL injection extracts data through boolean differences or response timing, with no error output required',
correct: true,
why: 'A payload using pg_sleep or a CASE expression leaks one bit per request through timing alone. Tools automate this entirely; hiding errors only slows an attacker down.',
},
{text: 'Yes — without error messages an attacker cannot learn the schema', why: 'Schema discovery is slower without errors, and blind techniques recover it regardless.'},
{text: 'Yes, provided the database user is not a superuser', why: 'Least privilege limits the damage. It does not prevent reading data the application can already read.'},
{text: 'Only if they also deploy a WAF', why: 'A WAF is a speed bump that a determined attacker bypasses. Neither is the fix.'},
]}
explanation={<>Suppressing errors is still worth doing — it is now its own OWASP category, A10:2025 — but as defence in depth. Parameterisation is what actually eliminates the vulnerability.</>}
reference={{label: 'Beyond the obvious', href: '/knowledge-base/security/sql-injection#beyond-the-obvious'}}
/>

<Quiz
question="Which of these are genuine defence-in-depth measures worth having alongside parameterisation?"
type="multiple"
options={[
{text: 'A database user without DROP, CREATE or superuser rights', correct: true, why: 'Turns a potential data-destruction incident into a read-scoped one, and blocks file-read primitives that need elevated privileges.'},
{text: 'Row-level security scoping queries to the current tenant', correct: true, why: 'Even a successful injection is confined to one tenant’s data.'},
{text: 'Generic error responses with the detail logged against a correlation id', correct: true, why: 'Denies an attacker a free schema map, and is now its own OWASP Top 10 category.'},
{text: 'Static analysis flagging concatenation into query calls', correct: true, why: 'Catches the pattern at review time, where the list of raw-query call sites is short and finite.'},
{text: 'A WAF, treated as the primary control', why: 'Useful for alerting and as a speed bump; trivially bypassed by an attacker paying attention, and never a substitute for parameterisation.'},
]}
explanation={<>The ordering matters: parameterise first, then layer these. Defence in depth around an injectable query is a slower breach, not a prevented one.</>}
reference={{label: 'Defence in depth', href: '/knowledge-base/security/sql-injection#defence-in-depth'}}
/>

<Quiz
question="A user named O'Brien cannot save their profile — the query fails with a syntax error. What does this tell you?"
options={[
{
text: 'The query is built by string concatenation and is therefore injectable — the apostrophe is closing the string literal early',
correct: true,
why: 'A parameterised query stores an apostrophe without difficulty. Breaking on one is the classic diagnostic that the value is being parsed as SQL.',
},
{text: 'The database character set needs changing to UTF-8', why: 'Encoding does not cause an apostrophe to break SQL syntax.'},
{text: 'The input needs escaping before saving', why: 'Escaping addresses the symptom by a fragile route. Parameterise instead.'},
{text: 'The column is too short for the value', why: 'A length problem produces a truncation or constraint error, not a syntax error.'},
]}
explanation={<>This is the cheapest injection test available, and it finds real vulnerabilities: any field that rejects an apostrophe, or mangles it, is being concatenated into SQL.</>}
reference={{label: 'Debugging', href: '/knowledge-base/security/sql-injection#debugging'}}
/>

---

## References

- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
  — parameterisation, allowlisting and least privilege.
- [OWASP Query Parameterization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html)
  — correct syntax in every major language.
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) — injection, and the new
  A10 category on error handling.
- [PortSwigger: SQL injection](https://portswigger.net/web-security/sql-injection)
  — labs covering blind and second-order techniques.
- [sqlmap](https://sqlmap.org/) — the automated tool, for authorised testing.
- [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
  — the tenant-isolation backstop.
