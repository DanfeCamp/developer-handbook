---
title: 'File Uploads'
description: 'Accepting files without accepting a vulnerability — pre-signed URLs, validation by content, safe storage and serving, resumable uploads and processing.'
---

# File Uploads

## Introduction

File upload is one of the few features that takes attacker-controlled **binary
content** and stores it on your infrastructure — and often serves it back to
other users. That combination makes it disproportionately dangerous relative to
how simple it looks.

**The three failure modes:**

1. **Security** — an uploaded file executes, either on your server or in another
   user's browser.
2. **Resources** — unbounded size or count exhausts disk, memory or bandwidth.
3. **Reliability** — large uploads fail on flaky connections and have to restart
   from zero.

**The architectural decision that solves most of the second and third problems:**
do not route file bytes through your application server. Issue a **pre-signed
URL** and let the client upload directly to object storage. Your server handles
metadata and permissions; the bytes never touch it.

---

## Direct-to-Storage Uploads

The default architecture for anything beyond small files.

```text
1. Client asks your API for permission to upload
2. API authorises, generates a pre-signed URL, records a pending upload
3. Client PUTs the file straight to S3/R2/GCS
4. Client (or a storage event) notifies your API that it completed
```

```ts
// Server: issue a short-lived, constrained upload URL
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

export async function createUploadUrl(user: User, input: {contentType: string; sizeBytes: number}) {
  // Authorise and validate BEFORE signing — the URL is a capability.
  if (!ALLOWED_TYPES.has(input.contentType)) throw new BadRequest('Unsupported file type');
  if (input.sizeBytes > MAX_BYTES) throw new BadRequest('File too large');

  const key = `uploads/${user.id}/${crypto.randomUUID()}`;

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: config.uploadBucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes, // binds the signature to a size
    }),
    {expiresIn: 300}, // five minutes
  );

  await db.upload.create({data: {key, userId: user.id, status: 'pending'}});
  return {url, key};
}
```

```ts
// Client: upload directly, then tell the API
await fetch(url, {method: 'PUT', body: file, headers: {'Content-Type': file.type}});
await fetch('/api/uploads/complete', {method: 'POST', body: JSON.stringify({key})});
```

**Why this is better:**

- Your servers never buffer large files, so memory stays flat.
- No request-timeout ceiling on upload duration.
- The storage provider handles throughput and geography.
- Scales without touching application capacity.

**The details that matter:**

- **Short expiry** — minutes, not hours. A pre-signed URL is a bearer capability.
- **Constrain the signature** — content type, and content length where supported.
  Without a size constraint, a signed URL is an unbounded write.
- **Generate the key server-side.** A client-supplied path is a path-traversal
  and overwrite vector.
- **Never trust the completion callback alone.** Verify the object exists and
  check its real size and type before marking it usable — the client may never
  call back, or may lie.

---

## Validation

**Never trust the filename, the extension, or the `Content-Type` header.** All
three are supplied by the client.

### Check the actual content

File type is determined by **magic bytes** at the start of the file:

```ts
import {fileTypeFromBuffer} from 'file-type';

const detected = await fileTypeFromBuffer(buffer.subarray(0, 4100));

// Allowlist, never blocklist
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

if (!detected || !ALLOWED.has(detected.mime)) {
  throw new BadRequest('Unsupported file type');
}
```

**Allowlist, never blocklist.** Blocking `.php` misses `.php5`, `.phtml`,
`.phar`, and case variations. Allowing exactly four types is enumerable and
correct.

**Content detection is necessary and not sufficient.** A polyglot file can be a
valid GIF _and_ valid PHP. The real defence is that uploads are never executable
where they are stored — see [below](#storage-and-serving).

### Other checks

- **Size limits at every layer** — client (for UX), application, and the reverse
  proxy. The proxy limit is the one that actually protects you, because it
  rejects before your process allocates anything.
- **Image dimensions.** A 50,000 × 50,000 pixel PNG can be a few hundred
  kilobytes compressed and gigabytes decompressed — a **decompression bomb**
  that exhausts memory in the resize step.
- **Archive contents**, if you accept zips: check the uncompressed size and
  entry paths before extracting. A zip entry named `../../etc/cron.d/x` is
  **Zip Slip**, and a small archive can expand to terabytes.
- **Re-encode images.** Decoding and re-encoding strips EXIF metadata (including
  GPS coordinates), removes embedded payloads and normalises the format. This is
  the single most effective image upload defence.

```ts
import sharp from 'sharp';

const clean = await sharp(buffer, {limitInputPixels: 50_000_000}) // guard against bombs
  .rotate() // apply EXIF orientation, then discard the metadata
  .resize(2000, 2000, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 82})
  .toBuffer();
```

---

## Storage and Serving

Where the serious vulnerabilities live.

**Never store uploads in the web root.** A file inside a directory the web
server will execute turns an upload into remote code execution. Object storage
avoids the question entirely.

**Generate filenames.** A user-supplied name enables path traversal
(`../../config.php`), overwriting other users' files, and filesystem quirks with
null bytes and unicode. Store the original name as metadata for display, and
sanitise it on output.

```ts
const key = `uploads/${user.id}/${crypto.randomUUID()}.${extension}`;
```

**Serve from a different origin.** This is the one people miss:

```text
app.example.com          ← your application
uploads.example.com      ← user content, a separate origin
```

An uploaded **SVG or HTML file served from your origin is stored XSS** — SVG is
XML and can contain `<script>`. On a separate origin, that script runs in an
origin with no session and no access to your data.

If a separate origin is impractical:

```http
Content-Disposition: attachment; filename="report.pdf"
Content-Type: application/octet-stream
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
```

`nosniff` stops the browser guessing a more dangerous type than you declared,
and `Content-Disposition: attachment` prevents inline rendering.

**Authorise downloads.** An unguessable URL is not access control. Either check
permissions in your handler and stream the object, or issue short-lived
pre-signed download URLs. See
[Authorization](/knowledge-base/security/authorization).

**Do not make the bucket public** unless the content genuinely is.

---

## Large and Resumable Uploads

A one-gigabyte upload over a mobile connection will fail. Plan for it.

**Multipart upload** splits the file into parts uploaded independently, with
only failed parts retried. Every major storage provider supports it, and their
SDKs handle the orchestration.

**Resumable protocols** — [tus](https://tus.io/) is the open standard — let an
upload continue after the browser is closed or the network changes. Worth
adopting when users upload video or large documents.

```ts
// Client-side chunking with progress and retry
const CHUNK = 5 * 1024 * 1024; // 5 MB — S3's minimum part size

for (let i = 0; i < parts.length; i++) {
  await uploadPartWithRetry(parts[i], signedUrls[i]);
  onProgress((i + 1) / parts.length);
}
```

**Show progress.** `XMLHttpRequest.upload.onprogress` or a `fetch` with a
`ReadableStream` body gives you byte-level progress; without it, a large upload
looks like a hung page.

**Clean up abandoned uploads.** Incomplete multipart uploads consume storage
indefinitely and are billed. Set a lifecycle rule:

```json
{"Rules": [{"Status": "Enabled", "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}}]}
```

---

## Processing

Do it **after** the response, not during it.

```ts
// The endpoint acknowledges; a worker does the work.
await db.upload.update({where: {key}, data: {status: 'processing'}});
await queue.enqueue('process-upload', {key});
return Response.json({status: 'processing'}, {status: 202});
```

Image resizing, video transcoding, virus scanning and text extraction are all
slow and all fail sometimes. Running them inline ties up a request thread, risks
a timeout, and gives the user no way to recover.

- **Make the job idempotent** — queues deliver at least once. See
  [Queues](/knowledge-base/operations/queues).
- **Track status** so the UI can show progress and failures.
- **Scan for malware** where users share files with one another — ClamAV, or a
  provider's scanning service.
- **Process in a sandbox.** Image and video libraries are large C codebases with
  a long history of parser vulnerabilities; a container with no network and no
  credentials limits the damage.

---

## The Browser Side

```html
<input type="file" id="avatar" accept="image/jpeg,image/png,image/webp" />
```

`accept` filters the file picker. It is **a convenience, not a control** — the
user can select anything, and a script can post anything.

```ts
const file = input.files[0];

// Client-side checks are for feedback, not security
if (file.size > MAX_BYTES) return showError('File too large');

// Compress before uploading — saves the user time and you bandwidth
const bitmap = await createImageBitmap(file);
const canvas = new OffscreenCanvas(1200, (1200 * bitmap.height) / bitmap.width);
canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
const compressed = await canvas.convertToBlob({type: 'image/webp', quality: 0.82});
```

Client-side compression is a genuine improvement for photo uploads from phones,
where a 12 MB original becomes a 300 KB upload. It does not replace server-side
validation and re-encoding.

Drag and drop, paste-to-upload, and a clear error state for rejected files are
the usual UX expectations.

---

## Do's and Don'ts

### Do

- Upload directly to object storage with short-lived pre-signed URLs.
- Validate type by magic bytes against an allowlist.
- Generate filenames and keys server-side.
- Enforce size limits at the proxy as well as the application.
- Re-encode images to strip metadata and embedded payloads.
- Serve user content from a separate origin.
- Authorise every download.
- Process asynchronously in a queue, in a sandbox.
- Expire incomplete multipart uploads with a lifecycle rule.

### Don't

- Don't trust the filename, extension or `Content-Type`.
- Don't store uploads in the web root.
- Don't use a client-supplied path or filename.
- Don't serve user-uploaded SVG or HTML from your application origin.
- Don't rely on `accept` or client-side validation for security.
- Don't blocklist extensions.
- Don't buffer whole files in memory.
- Don't treat an unguessable URL as access control.
- Don't resize images without a pixel limit.

---

## Common Mistakes

**Trusting `Content-Type`.** It is a client-supplied header; anyone can claim
`image/png` while sending a script.

**Blocklisting extensions.** `.php` blocked, `.phtml` allowed.

**Storing in the web root with the original name.** The classic path to remote
code execution.

**Serving SVGs from the application origin.** Stored XSS with your session
available to it.

**No proxy-level size limit.** The application limit runs after the body has
already been received.

**Buffering the whole file in memory.** Ten concurrent 500 MB uploads is five
gigabytes of RAM.

**Processing inline.** A timeout mid-transcode leaves a half-processed file and
no way to retry.

**No decompression-bomb guard.** A small PNG expanding to gigabytes in the
resize step.

**Forgetting abandoned multipart uploads.** Silent, indefinite storage cost.

**Not stripping EXIF.** Uploaded photos routinely carry GPS coordinates, which
is a genuine privacy leak when displayed publicly.

---

## Debugging

| Symptom                            | Cause and fix                                                           |
| ---------------------------------- | ----------------------------------------------------------------------- |
| 413 Payload Too Large              | Proxy body limit below the application's. Raise `client_max_body_size`. |
| Upload succeeds, file is corrupt   | Encoding mismatch, or a stream consumed twice.                          |
| Pre-signed URL rejected with 403   | Expired, or the request does not match the signed headers exactly.      |
| CORS error uploading to S3         | The bucket needs a CORS policy allowing `PUT` from your origin.         |
| Memory spikes during upload        | Buffering rather than streaming. Move to direct-to-storage.             |
| Large uploads time out             | Proxy or platform request timeout. Use multipart or resumable uploads.  |
| Storage bill grows unexplained     | Abandoned multipart uploads. Add a lifecycle rule.                      |
| Uploaded image rotated wrongly     | EXIF orientation not applied. `sharp().rotate()` before resizing.       |
| Malicious file stored successfully | Validated by extension rather than content.                             |

---

## FAQ

**Where should files be stored?**
Object storage — S3, R2, GCS, Azure Blob. Cheap, durable, scalable, and it keeps
executable content off your application servers. R2 is notable for having no
egress fees.

**Should uploads go through my server?**
Only for small files where you need to inspect content synchronously. Otherwise
use pre-signed URLs.

**How do I limit uploads per user?**
Track quota in your database and check it before issuing a pre-signed URL —
the URL is the point of authorisation.

**Is virus scanning necessary?**
If users share files with one another, yes. For a private avatar upload it is
lower value than correct storage and serving.

**How do I handle very large files?**
Multipart upload for chunking and retry, or tus for genuine resumability across
sessions.

**Can I serve uploads through a CDN?**
Yes — and for private content, use signed CDN URLs rather than making the bucket
public. See [CDN](/knowledge-base/hosting/cdn).

**What about EXIF data?**
Strip it by re-encoding. Photos routinely contain GPS coordinates, and
publishing them is a real privacy incident.

---

## Check your understanding

<Quiz
question="An application validates uploads by checking that the Content-Type header is image/png. Why is this insufficient?"
options={[
{
text: 'Content-Type is supplied by the client and can claim anything — validation must read the file\'s magic bytes and check against an allowlist',
correct: true,
why: 'The header is metadata the uploader chooses. Only inspecting the actual leading bytes tells you what the file is, and even then an allowlist is required rather than a blocklist.',
},
{text: 'Content-Type is reliable for images but not for documents', why: 'It is equally unreliable for every type — the client sets it.'},
{text: 'It is sufficient provided the extension also matches', why: 'The extension is also client-supplied. Two untrusted values do not make a trusted one.'},
{text: 'It is sufficient if the file is under the size limit', why: 'Size is unrelated to whether the content is what it claims to be.'},
]}
explanation={<>Content detection is necessary and not sufficient: a polyglot file can be a valid image <em>and</em> valid script. The real defence is that uploads are never executable where they are stored, and are served from an origin where script would be harmless.</>}
reference={{label: 'Validation', href: '/knowledge-base/web/file-uploads#validation'}}
/>

<Quiz
question="A site lets users upload profile pictures and serves them from app.example.com/uploads/. A user uploads an SVG. What is the risk?"
options={[
{
text: 'SVG is XML and can contain script — served from your origin it executes with your origin\'s privileges, giving stored XSS with access to session data',
correct: true,
why: 'The browser renders SVG as a document. Any script inside runs in the origin that served it, so it can read same-origin data and act as the logged-in user.',
},
{text: 'No risk, since SVG is an image format', why: 'It is a markup format that happens to describe images, and it supports scripting.'},
{text: 'Only a rendering inconsistency across browsers', why: 'Rendering differences exist and are not the security issue.'},
{text: 'Only a risk if the SVG is larger than the size limit', why: 'A few hundred bytes of SVG is enough to carry a payload.'},
]}
explanation={<>Serve user content from a separate origin so any script runs somewhere with no session. Where that is impractical, use <code>Content-Disposition: attachment</code>, <code>nosniff</code> and a restrictive CSP — and re-encode images to a raster format where you can.</>}
reference={{label: 'Storage and serving', href: '/knowledge-base/web/file-uploads#storage-and-serving'}}
/>

<Quiz
question="Which are genuine advantages of pre-signed direct-to-storage uploads over routing bytes through your API?"
type="multiple"
options={[
{text: 'Application servers never buffer large files, so memory usage stays flat', correct: true, why: 'Ten concurrent large uploads through your API is gigabytes of RAM; via pre-signed URLs it is zero.'},
{text: 'Upload duration is not bounded by your request timeout', correct: true, why: 'The transfer happens between client and storage provider, outside your platform’s request limits.'},
{text: 'Throughput scales with the storage provider rather than your application capacity', correct: true, why: 'You are no longer the bottleneck for bandwidth.'},
{text: 'The pre-signed URL removes the need to authorise the upload', why: 'The opposite — authorisation happens _before_ signing, because the URL is a bearer capability that anyone holding it can use.'},
{text: 'Client-supplied object keys become safe, since storage handles paths', why: 'A client-supplied key is still a path-traversal and overwrite vector. Generate keys server-side.'},
]}
explanation={<>Two constraints make the pattern safe: a short expiry (minutes), and binding the signature to content type and length — an unconstrained signed URL is an unbounded write to your bucket.</>}
reference={{label: 'Direct-to-storage uploads', href: '/knowledge-base/web/file-uploads#direct-to-storage-uploads'}}
/>

<Quiz
question="A service resizes uploaded images. A 400 KB PNG causes the worker to run out of memory. What happened?"
options={[
{
text: 'A decompression bomb — the image has enormous pixel dimensions that compress well but expand to gigabytes when decoded for resizing',
correct: true,
why: 'A 50,000 × 50,000 pixel image of flat colour is tiny compressed and enormous in memory. Set a pixel limit (sharp’s limitInputPixels) and reject oversized dimensions before decoding.',
},
{text: 'The file size limit was set too high', why: 'The file is 400 KB — file size is not the constraint that failed.'},
{text: 'The image format is unsupported by the library', why: 'An unsupported format errors quickly rather than exhausting memory.'},
{text: 'Too many concurrent uploads', why: 'The premise is a single file causing the failure.'},
]}
explanation={<>Validate <em>dimensions</em> as well as bytes, and process in a sandboxed worker — image libraries are large C codebases with a long history of parser vulnerabilities.</>}
reference={{label: 'Other checks', href: '/knowledge-base/web/file-uploads#other-checks'}}
/>

<Quiz
question="An upload endpoint resizes images and generates thumbnails inline before responding. What problems does this cause?"
options={[
{
text: 'A request thread is tied up for the duration, large files risk a timeout, and a failure mid-processing leaves no way to retry',
correct: true,
why: 'Processing is slow and fails sometimes. Acknowledging with 202 and queueing the work keeps the request fast, makes retries possible, and lets the UI show progress.',
},
{text: 'Nothing, provided the server has enough CPU', why: 'CPU is not the issue — request duration, timeout risk and unrecoverable failure are.'},
{text: 'Only that thumbnails will be lower quality', why: 'Quality is unrelated to when the work runs.'},
{text: 'It prevents the use of object storage', why: 'The two are independent choices.'},
]}
explanation={<>Make the job idempotent, since queues deliver at least once, and track status so the interface can distinguish "processing" from "failed" — otherwise users retry uploads that are already in flight.</>}
reference={{label: 'Processing', href: '/knowledge-base/web/file-uploads#processing'}}
/>

---

## References

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
  — the definitive security checklist.
- [AWS: Pre-signed URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
  — direct upload, with the constraints available.
- [tus](https://tus.io/) — the open resumable upload protocol.
- [sharp](https://sharp.pixelplumbing.com/) — fast image processing, with
  `limitInputPixels`.
- [file-type](https://github.com/sindresorhus/file-type) — magic-byte detection.
- [Snyk: Zip Slip](https://security.snyk.io/research/zip-slip-vulnerability) —
  archive path traversal.
- [MDN: File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API) —
  the browser side.
