---
title: 'Data Representation'
description: 'How text, numbers, time and structured data are actually stored — Unicode, IEEE-754, timezones, and the serialisation limits that cause silent data loss.'
---

# Data Representation

## Introduction

Every value in your program is bytes with an agreed interpretation. When the
agreement is wrong — or merely assumed — you get the bugs that are hardest to
find, because the code looks correct and the data is quietly wrong.

**The four that account for most of them:**

- **Text** — one character is not one byte, and often not one code unit either.
- **Numbers** — `0.1 + 0.2 !== 0.3`, and money must never be a float.
- **Time** — the single richest source of production bugs in software.
- **Serialisation** — JSON loses precision, types and intent, silently.

These are not language quirks. They are properties of the underlying
representations, shared by JavaScript, Python, Java, PHP, Go and C. Learn them
once and they apply everywhere.

---

## Text

A string is a sequence of numbers with an agreed interpretation.

| Term                 | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| **Code point**       | One Unicode character, e.g. `U+0041` for `A`         |
| **Encoding**         | Rules turning code points into bytes — UTF-8, UTF-16 |
| **Code unit**        | The fixed-size chunk an encoding works in            |
| **Grapheme cluster** | What a human calls a character                       |

**UTF-8 uses 1–4 bytes per code point**, is ASCII-compatible, and is the correct
default for essentially everything: files, databases, HTTP, source code.

**A grapheme cluster can be several code points** — an emoji with a skin-tone
modifier, a flag, or `é` written as `e` plus a combining accent. This is why
"length" is not a simple question:

```js
'👨‍👩‍👧'.length; // 8 — UTF-16 code units, what JS counts
[...'👨‍👩‍👧'].length; // 5 — code points
[...new Intl.Segmenter().segment('👨‍👩‍👧')].length; // 1 — grapheme clusters
```

**The practical rules:**

- **Never validate a username with `value.length <= 20`** and assume it means
  twenty characters. Use `Intl.Segmenter` if the limit is meant to be visual, or
  count bytes if the limit is storage.
- **Never slice a string at an arbitrary byte offset.** You will cut a
  multi-byte sequence in half and produce `�`.
- **Normalise before comparing.** `é` as one code point and `é` as two are
  visually identical and not equal. `str.normalize('NFC')` before storing or
  comparing removes the whole class of bug.
- **Case conversion is locale-dependent.** Turkish dotless `ı` is the classic
  example: `'I'.toLowerCase()` is not `'ı'` in every locale.
- **Set the database collation deliberately.** MySQL's `utf8` is not UTF-8 — it
  is a three-byte subset that cannot store emoji. You want `utf8mb4`.

---

## Numbers

JavaScript numbers are IEEE-754 doubles. So are `float` and `double` in most
languages. They are **binary** fractions, and most decimal fractions cannot be
represented exactly:

```js
0.1 + 0.2; // 0.30000000000000004
0.1 + 0.2 === 0.3; // false
```

This is not a JavaScript defect. Python, Java and C behave identically, because
the representation is the same.

**Consequences worth internalising:**

- **Never store money as a float.** Use integer minor units (pence, cents) or a
  decimal type. `19.99` cannot be represented exactly; `1999` can. Databases
  offer `NUMERIC`/`DECIMAL` for exactly this.
- **Never compare floats with `===`.** Compare against a tolerance:
  `Math.abs(a - b) < Number.EPSILON * 100`.
- **Integers are exact only up to `Number.MAX_SAFE_INTEGER`** (2^53 − 1). Beyond
  it, arithmetic silently loses precision.
- **Treat large IDs as strings in JSON.** Database bigints and snowflake IDs
  exceed the safe range, and `JSON.parse` mangles them without warning.
- **Rounding is not obvious.** `Math.round(-0.5)` is `-0`, and rounding half-up
  versus half-to-even changes financial totals. Decide deliberately.

**`BigInt` is for exact integers beyond 2^53** — snowflake IDs, nanosecond
timestamps, cryptographic values. It does not mix with `Number` in arithmetic,
and `JSON.stringify` throws on it. It is not the right tool for money; integer
minor units or a decimal library are clearer.

---

## Time

The richest source of production bugs in this entire handbook.

**The rules, in order of how much trouble they save:**

- **Store and transmit UTC.** Convert to a local timezone only at the moment of
  display.
- **Use ISO 8601 on the wire** — `2026-08-02T14:30:00Z`. It sorts
  lexicographically, is unambiguous, and every language parses it.
- **A timezone is not an offset.** `Europe/London` is a timezone; `+01:00` is
  the offset it happens to have in summer. Store the **identifier** when you
  need to schedule future events, because offsets change and governments
  redefine them.
- **Daylight saving means some local times do not exist and others happen
  twice.** "Add one day" is not "add 86,400 seconds".
- **Use a monotonic clock for durations** — `performance.now()`, not
  `Date.now()`. The wall clock jumps backwards when NTP corrects it, which can
  produce negative elapsed times.
- **A date is not a timestamp.** A birthday has no time and no timezone;
  storing it as a `DATETIME` at midnight UTC shifts it a day for half the world.

```js
// Formatting for a user, correctly.
new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/London',
}).format(new Date('2026-08-02T14:30:00Z'));

// Date arithmetic with the modern Temporal API — DST-aware.
const meeting = Temporal.ZonedDateTime.from(
  '2026-08-02T14:30[Europe/London]',
).add({days: 1});

// A calendar date with no time and no zone.
const birthday = Temporal.PlainDate.from('1990-04-17');
```

**`Temporal` fixes what `Date` got wrong** — immutability, real timezone
support, separate types for instants, calendar dates and durations. It reached
Stage 3 and is shipping across engines; use it where available, and `date-fns`
or `Luxon` otherwise. **`moment` is in maintenance mode** and should not be used
in new code.

---

## Serialisation

**JSON** is the default interchange format. Its limits cause quiet data loss:

| Not supported             | What happens                                   |
| ------------------------- | ---------------------------------------------- |
| Comments, trailing commas | Parse error                                    |
| `undefined`               | Dropped from objects, becomes `null` in arrays |
| `Date`                    | Becomes an ISO string; does not round-trip     |
| `BigInt`                  | `JSON.stringify` throws                        |
| `Map`, `Set`              | Become `{}`                                    |
| Cycles                    | Throws                                         |
| Integers beyond 2^53      | **Silently loses precision**                   |

That last row is the dangerous one. `JSON.parse('{"id": 9007199254740993}')`
returns `9007199254740992`, with no error. Serialise large IDs as strings.

**Key order is preserved in practice but not guaranteed by specification**, so
never derive a signature or hash from `JSON.stringify` output unless you sort
keys deterministically first.

**Base64 is an encoding, not encryption or compression.** It makes binary data
survive a text channel at a cost of roughly 33% more bytes. **A base64 string in
a URL or a JWT payload is readable by anyone** — encoding is not protection. See
[JWT](/knowledge-base/security/jwt).

**Alternatives worth knowing:** Protocol Buffers and MessagePack for compact
binary with a schema; NDJSON for streaming large datasets line by line; CSV
only when a spreadsheet is the destination, and never for nested data.

---

## Do's and Don'ts

### Do

- Use UTF-8 everywhere, and `utf8mb4` in MySQL.
- Normalise strings with `normalize('NFC')` before comparing or storing.
- Count grapheme clusters when a limit is meant to be visual.
- Store money as integer minor units or a decimal type.
- Compare floats against a tolerance.
- Store and transmit UTC in ISO 8601.
- Store timezone identifiers, not offsets, for future events.
- Use `performance.now()` for durations.
- Serialise large IDs as strings.
- Use `Temporal` or a maintained date library for arithmetic.

### Don't

- Don't assume one character is one byte, or one code unit.
- Don't slice strings at arbitrary byte offsets.
- Don't store money as a float.
- Don't compare floats with `===`.
- Don't store a UTC offset when you need a timezone.
- Don't treat "add a day" as "add 86,400 seconds".
- Don't rely on `JSON.parse` for 64-bit integers.
- Don't treat base64 as a security measure.
- Don't use `moment` in new code.

---

## Common Mistakes

**Off-by-one on timezones.** Formatting a UTC timestamp in local time shifts the
date by a day. Reports that are "off by one" near midnight are almost always
this.

**A birthday stored as a timestamp.** Midnight UTC becomes the previous day for
anyone west of Greenwich.

**Money in floats.** Totals that disagree with the sum of their parts by a
penny, reproducible only for certain amounts.

**A 64-bit ID through `JSON.parse`.** Silently rounded, and the record cannot be
found afterwards.

**MySQL `utf8`.** Not UTF-8. Emoji throw or are replaced. Use `utf8mb4`.

**Unnormalised comparison.** Two visually identical strings that are not equal,
producing duplicate accounts.

**`parseInt` on user input.** `parseInt('12abc')` silently returns `12`. Use
`Number()` and check `Number.isNaN`.

**Base64 mistaken for encryption.** A "encoded" API key in a config file is a
plaintext API key.

---

## Debugging

| Symptom                                        | Likely cause                                |
| ---------------------------------------------- | ------------------------------------------- |
| `�` in output                                  | Byte-level slicing, or an encoding mismatch |
| Emoji rejected by the database                 | MySQL `utf8` rather than `utf8mb4`          |
| Duplicate accounts with identical names        | Unnormalised Unicode                        |
| Totals off by a penny                          | Floating-point money                        |
| Record not found by ID                         | Precision lost in `JSON.parse`              |
| Date one day out for some users                | UTC/local conversion at display time        |
| Scheduled job fires an hour early twice a year | Offset stored instead of timezone           |
| Negative elapsed time                          | Wall clock used for a duration              |

**Print the code points.** `[...str].map((c) => c.codePointAt(0).toString(16))`
resolves most text mysteries immediately — it distinguishes a combining accent
from a precomposed character, and reveals invisible zero-width joiners.

---

## FAQ

**When should I use `BigInt`?**
When an integer can exceed 2^53 − 1: snowflake IDs, nanosecond timestamps,
cryptographic values. Not for money — integer minor units or a decimal type is
clearer.

**Why not just store local time?**
Offsets change twice a year, governments redefine timezones, and an ambiguous
local time cannot be resolved back to an instant. Store UTC, plus the timezone
identifier if you need to render or schedule locally.

**Is `Temporal` ready to use?**
It is Stage 3 and shipping in current engines, with a well-maintained polyfill.
For new code, yes. `date-fns` remains a sound choice.

**How do I store money?**
Integer minor units in a `BIGINT`, or `NUMERIC(19,4)`. Store the currency code
alongside — an amount without a currency is meaningless.

**Should I ever use `float` in a database?**
For measurements where approximation is acceptable — sensor readings,
coordinates, scores. Never for money or counts.

**How do I compare user-entered text reliably?**
Normalise to NFC, trim, and case-fold with a specified locale. For search, a
proper collation or a search engine handles this better than string comparison.

---

## Check your understanding

<Quiz
question="What does this print, and why?"
options={[
{
text: 'false — 0.1 and 0.2 have no exact binary representation, so their sum is slightly greater than 0.3',
correct: true,
why: 'IEEE-754 doubles are binary fractions. 0.1 + 0.2 evaluates to 0.30000000000000004, which is not equal to the double nearest 0.3.',
},
{
text: 'true — JavaScript rounds to 15 significant digits before comparing',
why: 'Rounding happens when converting to a string for display, not during comparison.',
},
{
text: 'false — but only in JavaScript; other languages get this right',
why: 'Any language using IEEE-754 doubles behaves identically. This is Python, Java and C too.',
},
{
text: 'true — === performs numeric coercion with a tolerance',
why: '=== performs no coercion at all, and no comparison operator applies a tolerance.',
},
]}
explanation={<>Compare with a tolerance, and store money as integer minor units so the question never arises.</>}
reference={{label: 'Numbers', href: '/knowledge-base/general/data-representation#numbers'}}>

```js
console.log(0.1 + 0.2 === 0.3);
```

</Quiz>

<Quiz
question="A username field validates with `value.length <= 20`. A user reports that their eight-character name is rejected. What is happening?"
options={[
{
text: '.length counts UTF-16 code units, and emoji or accented characters consume several each',
correct: true,
why: 'A single emoji can be two code units, and a family emoji with joiners can be eight. Eight visible characters can easily exceed twenty code units.',
},
{text: 'The field is trimming whitespace incorrectly', width: false, why: 'Trimming would shorten the value, not lengthen it.'},
{text: 'The database column is too narrow', why: 'The premise is that client-side validation rejects it before any database write.'},
{text: 'JavaScript strings have a maximum length of 20 by default', why: 'There is no such default.'},
]}
explanation={<>Decide what the limit means. If it is visual, count grapheme clusters with <code>Intl.Segmenter</code>. If it is storage, count bytes. <code>.length</code> answers neither question.</>}
reference={{label: 'Text', href: '/knowledge-base/general/data-representation#text'}}
/>

<Quiz
question="A scheduling feature stores meeting times as UTC instants. Users report that recurring weekly meetings shift by an hour twice a year. What is wrong?"
options={[
{
text: 'A recurring local appointment needs the timezone identifier stored, not a fixed instant — the correct local time maps to a different UTC instant after a DST transition',
correct: true,
why: '"Every Tuesday at 09:00 in London" is a rule in a timezone. Freezing it to a UTC instant bakes in one particular offset, which stops being correct when the offset changes.',
},
{text: 'The UTC timestamps are being stored with the wrong precision', width: false, why: 'Precision does not produce a one-hour seasonal shift.'},
{text: 'The client should convert to local time before sending', why: 'Sending local time without a zone is more ambiguous, not less.'},
{text: 'The server clock is drifting', why: 'Clock drift is gradual and does not align with DST boundaries.'},
]}
explanation={<>Store UTC for things that <em>happened</em>, and a local time plus a timezone identifier for things that will <em>recur</em>. <code>Temporal.ZonedDateTime</code> models exactly this distinction.</>}
reference={{label: 'Time', href: '/knowledge-base/general/data-representation#time'}}
/>

<Quiz
question="Which of these cause silent data loss through JSON?"
type="multiple"
options={[
{text: 'Integers above 2^53 − 1 losing precision on parse', correct: true, why: 'JSON.parse returns the nearest double with no error, so a bigint ID comes back subtly wrong and the record cannot be found.'},
{text: 'Date objects becoming strings that do not round-trip', correct: true, why: 'JSON has no date type. Serialising gives an ISO string, and parsing gives a string back — not a Date.'},
{text: 'undefined properties disappearing from objects', correct: true, why: 'JSON.stringify omits them entirely, so the receiving end cannot distinguish absent from undefined.'},
{text: 'Map and Set serialising as empty objects', correct: true, why: 'They have no JSON representation and stringify to {}, discarding all entries without warning.'},
{text: 'BigInt values being converted to strings automatically', why: 'JSON.stringify throws a TypeError on BigInt rather than converting — noisy, not silent, which makes it the safer failure.'},
]}
explanation={<>The dangerous ones are those that fail without an error. Serialise large IDs as strings, and use an explicit reviver or a schema library when a payload must round-trip faithfully.</>}
reference={{label: 'Serialisation', href: '/knowledge-base/general/data-representation#serialisation'}}
/>

<Quiz
question="Two user accounts exist with what appears to be the identical name `José`. What is the most likely explanation?"
options={[
{
text: 'One uses the precomposed character U+00E9 and the other uses `e` plus a combining acute accent — visually identical, not equal as strings',
correct: true,
why: 'Unicode allows multiple encodings of the same visual result. Without normalisation, an equality check or a unique constraint treats them as different values.',
},
{text: 'One name contains a trailing space', width: false, why: 'Possible in general, and Unicode composition is the specific cause of identical-looking distinct strings.'},
{text: 'The database collation is case-insensitive', width: false, why: 'Case-insensitivity would merge them, producing the opposite of the reported problem.'},
{text: 'One is stored in UTF-8 and the other in UTF-16', why: 'Encoding is a storage detail; the decoded string values would still compare equal.'},
]}
explanation={<>Call <code>normalize('NFC')</code> before storing or comparing user-entered text. Apply it at the boundary, so everything inside the system is already in one canonical form.</>}
reference={{label: 'Text', href: '/knowledge-base/general/data-representation#text'}}
/>

---

## References

- [The Unicode Standard](https://www.unicode.org/standard/standard.html) and
  [UTS #29: Text Segmentation](https://unicode.org/reports/tr29/) — code points
  versus grapheme clusters.
- [What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)
  — the definitive treatment.
- [MDN: Intl.Segmenter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)
  — counting what users call characters.
- [Temporal documentation](https://tc39.es/proposal-temporal/docs/) — the modern
  JavaScript date and time API.
- [IANA Time Zone Database](https://www.iana.org/time-zones) — the identifiers
  to store, and how often they change.
- [RFC 8259: JSON](https://www.rfc-editor.org/rfc/rfc8259) — what the format
  does and does not guarantee.
