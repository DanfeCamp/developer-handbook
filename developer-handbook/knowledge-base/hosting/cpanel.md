---
title: 'cPanel'
description: 'Working effectively with shared hosting control panels — domains, databases, email, AutoSSL, cron, and the constraints that decide what you can deploy.'
---

# cPanel

## Introduction

cPanel is the dominant control panel on shared hosting: a web interface over
domains, files, databases, email, TLS and cron on a server you do not
administer.

**You will meet it whether or not you choose it.** Client sites, inherited
projects and most WordPress hosting run on cPanel, so knowing your way around it
is a practical necessity even if your own work runs elsewhere.

**The constraints define what is possible:**

- **No root.** You cannot install system packages, edit server configuration, or
  restart services.
- **Shared resources.** CPU, memory and process counts are capped, and another
  account on the machine affects you.
- **PHP-centric.** PHP is a first-class citizen; Node, Python and Ruby run
  through Passenger with real limitations.
- **No persistent processes**, in general. Queue workers and WebSocket servers
  are usually not viable.

**What deploys well:** WordPress, Laravel, static sites, PHP applications,
anything request-scoped and modest in traffic.

**What does not:** applications needing background workers, WebSockets,
container runtimes, or specific system libraries. Those need
[a VPS](/knowledge-base/hosting/vps).

---

## Domains

Four kinds, and the distinction confuses people:

| Type               | What it is                                   |
| ------------------ | -------------------------------------------- |
| **Primary**        | The account's main domain                    |
| **Addon**          | A separate domain served from a subdirectory |
| **Subdomain**      | `blog.example.com`, its own document root    |
| **Parked / Alias** | Another domain showing the same site         |

**The addon-domain trap.** An addon domain's files live in a subdirectory of
`public_html` — typically `public_html/addon.com/`. That means the addon site is
_also_ reachable at `primary.com/addon.com/`, which duplicates your content at a
second URL. Search engines index both, and it looks like duplicate content.

Fix it by moving addon document roots outside `public_html` if your host permits,
or by redirecting the subdirectory path to the correct domain.

**Point DNS before creating the domain in cPanel**, or you will see the wrong
site while records propagate. See [DNS](/knowledge-base/hosting/dns).

---

## Files

**File Manager** works for quick edits and is slow and error-prone for real
deployment.

**SFTP over FTP, always.** Plain FTP transmits credentials in cleartext; most
hosts support SFTP on port 22 or FTPS. If your host offers only plain FTP,
consider whether you trust it with anything else.

**Terminal access** exists on many plans — SSH into the account and you get git,
composer and a shell, which transforms the workflow:

```bash
ssh user@example.com -p 2222
cd ~/public_html
git pull origin main
composer install --no-dev --optimize-autoloader
```

**Deploy with git where possible.** cPanel's Git Version Control feature can
clone a repository and deploy on push via a `.cpanel.yml` file:

```yaml
---
deployment:
  tasks:
    - export DEPLOYPATH=/home/user/public_html/
    - /bin/cp -R * $DEPLOYPATH
```

**Never edit files directly on the server** as your workflow. It works, and it
means production is the only copy of the truth, with no history and no review.

**Watch the inode limit.** Shared hosts cap the _number_ of files, not just
their size, and `node_modules` or a large media library will hit it well before
the disk quota. This is a common and mystifying "disk full" error on an account
using 20% of its space.

---

## Databases

MySQL or MariaDB, managed through the panel with phpMyAdmin for queries.

**The naming convention catches everyone:** cPanel prefixes database and user
names with the account name. You ask for `myapp` and get `cpuser_myapp`. Use the
full prefixed name in your application configuration.

**Creating a working database is three steps**, and people stop after two:

1. Create the database.
2. Create the user.
3. **Add the user to the database with privileges.** Skipping this produces an
   access-denied error that looks like a wrong password.

**Connect over `localhost`**, since the application runs on the same machine.
Remote MySQL access requires whitelisting your IP and is best avoided —
it exposes the database to the internet for the sake of a local GUI.

**Backups:** the panel's backup tool covers files and databases, and it is
manual on many plans. **Download backups off the server** — a backup on the same
account does not survive the account being suspended or compromised. Automate it
with a cron job to remote storage if you can.

---

## Email

cPanel includes a full mail server, and this is genuinely one of its
conveniences.

**Deliverability is the hard part**, and it is mostly DNS:

- **SPF** — which servers may send as your domain.
- **DKIM** — cryptographic signing; cPanel can generate the keys.
- **DMARC** — what receivers should do when SPF and DKIM fail.

All three are in cPanel's Email Deliverability section, which will tell you what
is missing. **Configure all three**, or your mail lands in spam folders.

**Shared IP reputation is a real risk.** You share an outbound IP with every
other account on the server, and one spammer among them affects your delivery.

**For transactional mail — password resets, receipts, notifications — use a
dedicated provider** (Postmark, SES, Mailgun, Resend) over SMTP rather than the
local mail server. Better deliverability, real logs, and bounce handling. See
[Email](/knowledge-base/web/email).

Keep cPanel mail for human mailboxes; send application mail through a provider.

---

## SSL with AutoSSL

cPanel issues and renews free certificates automatically through AutoSSL, and it
works well.

**Points to check:**

- **Every hostname needs coverage** — the bare domain, `www`, and each
  subdomain. AutoSSL usually handles this and occasionally misses one.
- **DNS must resolve to this server** before issuance succeeds. Validation
  requires reachability.
- **Behind a proxied CDN**, HTTP validation can fail. Pause proxying during
  issuance, or use the CDN's origin certificate. See
  [Cloudflare](/knowledge-base/cloudflare).
- **Force HTTPS** in Domains → the redirect toggle, or via `.htaccess`.

Check renewal occasionally. AutoSSL is reliable and not infallible, and a
certificate expiring on a client site is an avoidable emergency. See
[SSL/TLS](/knowledge-base/hosting/ssl-tls).

---

## PHP Configuration

**MultiPHP Manager** sets the PHP version per domain. **Match it to what your
application supports**, and update deliberately — an unsupported PHP version
stops receiving security patches.

**MultiPHP INI Editor** exposes the settings that matter:

| Setting               | Notes                                                     |
| --------------------- | --------------------------------------------------------- |
| `memory_limit`        | 256M+ for WordPress with plugins                          |
| `upload_max_filesize` | Must be raised with `post_max_size` together              |
| `post_max_size`       | Must be ≥ `upload_max_filesize`, or uploads fail silently |
| `max_execution_time`  | Long imports and migrations need more                     |
| `display_errors`      | **Off in production**, always                             |

**Select PHP Version** also manages extensions. Missing extensions are the usual
cause of a Laravel or WordPress plugin failing to install — check the
requirements against what is enabled.

**`display_errors` on in production leaks file paths, database names and stack
traces.** Log errors instead, and read the log.

---

## Cron

The only scheduling available, and the substitute for background workers.

```
*/5 * * * * /usr/local/bin/php /home/user/public_html/artisan schedule:run >/dev/null 2>&1
```

**Practical notes:**

- **Use absolute paths** for both the interpreter and the script. Cron's `PATH`
  is minimal and does not include what your shell has.
- **Redirect output**, or every run emails you.
- **Minimum interval is one minute**, and many shared hosts enforce longer.
- **The PHP CLI binary differs from the web PHP version.** Use the full path to
  the correct one; hosts often provide `ea-php82` style binaries.

**Cron is not a queue.** Laravel's `schedule:run` every minute is the supported
pattern on shared hosting; a long-running `queue:work` daemon will be killed by
the process limits. Use `queue:work --stop-when-empty` from cron instead. See
[Background Workers](/knowledge-base/operations/background-workers).

---

## Security

You do not control the server, and you do control your account.

- **Strong, unique passwords, with 2FA** on the cPanel account itself. A
  compromised panel account is a compromised everything.
- **Keep applications updated.** Outdated WordPress plugins are the leading
  cause of shared-hosting compromise, by a wide margin.
- **File permissions:** `644` for files, `755` for directories. **Never `777`** —
  it is the "fix" that every tutorial suggests and that makes files writable by
  every account on a shared machine.
- **Move secrets out of the web root.** A `.env` inside `public_html` can be
  served as plain text if PHP fails to execute. Point the document root at
  `public/` and keep the application above it.
- **Restrict `.htaccess` access** to sensitive files, and confirm your host does
  not disable `AllowOverride`.
- **Check for unexpected files** after any suspected compromise — attackers
  leave web shells in upload directories.

**On shared hosting, one compromised account can affect others.** Your own
hygiene is what you control.

---

## Do's and Don'ts

### Do

- Use SFTP or SSH rather than plain FTP.
- Deploy from git rather than editing on the server.
- Use the full prefixed database and user names.
- Grant the user privileges on the database explicitly.
- Configure SPF, DKIM and DMARC.
- Send transactional mail through a dedicated provider.
- Keep `display_errors` off and read the error log.
- Use absolute paths in cron jobs.
- Download backups off the server.
- Enable 2FA on the cPanel account.

### Don't

- Don't use `chmod 777` for anything, ever.
- Don't leave `.env` or config files inside the web root.
- Don't expect long-running processes to survive.
- Don't enable remote MySQL access for convenience.
- Don't rely on the host's backups alone.
- Don't run an unsupported PHP version.
- Don't ignore the inode limit.
- Don't leave plugins and themes un-updated.

---

## Common Mistakes

**Database access denied with the correct password.** The user was created but
never added to the database, or the account prefix is missing from the name.

**`chmod 777` to fix a permissions error.** Makes the file writable by every
account on the server. The correct answer is ownership and `644`/`755`.

**`.env` in the web root.** Directly fetchable if PHP stops executing, and it
contains your database credentials and API keys.

**Uploads failing silently.** `post_max_size` is lower than
`upload_max_filesize`; both must be raised together.

**"Disk full" at 20% usage.** The inode limit, not the disk quota.

**Application mail going to spam.** No DKIM or DMARC, and a shared outbound IP.
Use a mail provider.

**A `queue:work` daemon that keeps dying.** Process limits kill it. Run it from
cron with `--stop-when-empty`.

**Duplicate content from an addon domain.** The site is reachable at both its own
domain and a subdirectory of the primary.

**Cron job that works manually but not scheduled.** A relative path, or the
wrong PHP binary.

---

## Debugging

| Symptom                 | Where to look                                             |
| ----------------------- | --------------------------------------------------------- |
| 500 error               | `error_log` in the directory; enable logging, not display |
| Database access denied  | User privileges; prefixed names                           |
| Uploads fail            | `post_max_size` vs `upload_max_filesize`                  |
| Cron not running        | Absolute paths; correct PHP binary; check the mail output |
| Certificate not issuing | DNS resolution; CDN proxying during validation            |
| Mail in spam            | Email Deliverability panel — SPF, DKIM, DMARC             |
| Disk full at low usage  | Inode count                                               |
| Site slow at intervals  | Shared resource limits; check the resource usage graphs   |
| White screen            | PHP fatal error — read the log, do not display it         |

**Read `error_log`.** cPanel writes one in the directory where the error
occurred, and it usually contains the exact answer. Most "the site is broken"
questions are resolved by opening it.

---

## FAQ

**Can I run Node.js?**
Often, through the Application Manager or Passenger. It works for request-scoped
applications and is unreliable for WebSockets or long-running processes.

**Can I use Composer?**
Yes, with SSH access. Run `composer install --no-dev` on the server, or commit
`vendor/` if you have no shell.

**Is shared hosting secure?**
Adequately, for what it is. The host patches the server; you are responsible for
your application. The main risk is your own outdated software.

**When should I move to a VPS?**
When you need background workers, WebSockets, containers, specific system
packages, or when resource limits are throttling you. Also when the site earns
enough that an hour of your time costs less than the outages.

**Can I get SSH?**
Most hosts offer it, sometimes on request or on higher plans. Ask — it changes
the workflow substantially.

**What about staging?**
A subdomain with its own database works well. Password-protect it and add
`noindex`, or search engines will index your staging site.

---

## Check your understanding

<Quiz
question="An application on cPanel reports 'Access denied for user' despite the password being correct and the database existing. What is the most likely cause?"
options={[
{
text: 'The user was created but never added to the database with privileges, or the account prefix is missing from the names',
correct: true,
why: 'Creating a database and creating a user are separate steps from granting that user access. cPanel also prefixes both names with the account name, so myapp is really cpuser_myapp.',
},
{text: 'MySQL is not running on the server', why: 'That produces a connection error rather than an authentication failure.'},
{text: 'The application must connect over the public IP rather than localhost', why: 'Localhost is correct — the application runs on the same machine, and remote access needs explicit whitelisting.'},
{text: 'The password contains characters MySQL cannot accept', why: 'MySQL accepts arbitrary password characters; escaping in a config file is a separate matter.'},
]}
explanation={<>Three steps, and people stop after two: create the database, create the user, then add the user to the database with privileges. Use the full prefixed names in your configuration.</>}
reference={{label: 'Databases', href: '/knowledge-base/hosting/cpanel#databases'}}
/>

<Quiz
question="A tutorial suggests running chmod 777 to fix a file-permission error on shared hosting. Why is this dangerous here specifically?"
options={[
{
text: 'It makes the file writable by every account on the shared server, not just yours',
correct: true,
why: 'On shared hosting many customers run on the same machine. World-writable means writable by other tenants, which turns any one of their compromises into yours.',
},
{text: 'It prevents PHP from executing the file', why: 'Some configurations refuse to execute group- or world-writable scripts, and that is a symptom rather than the core risk.'},
{text: 'cPanel resets permissions automatically overnight', why: 'It does not; the change persists.'},
{text: 'It causes the file to count double against the inode limit', why: 'Permissions do not affect inode counts.'},
]}
explanation={<>Use <code>644</code> for files and <code>755</code> for directories, and fix ownership rather than loosening permissions. If a directory genuinely needs to be writable by the web server, that is what <code>775</code> with correct group ownership is for.</>}
reference={{label: 'Security', href: '/knowledge-base/hosting/cpanel#security'}}
/>

<Quiz
question="An account reports 'disk quota exceeded' while the cPanel dashboard shows only 20% of the disk in use. What is happening?"
options={[
{
text: 'The inode limit has been reached — shared hosts cap the number of files, not only their total size',
correct: true,
why: 'A node_modules tree or a large media library contains enormous numbers of small files. The inode cap is hit long before the disk quota.',
},
{text: 'The dashboard figure is cached and out of date', why: 'A plausible guess, and the specific pairing of low usage with a quota error points at inodes.'},
{text: 'Database storage is counted separately and is full', why: 'Databases do count toward the quota, and that would show as higher disk usage.'},
{text: 'The backup directory is hidden from the usage figure', why: 'Backups count toward usage and would appear in the total.'},
]}
explanation={<>Delete build artefacts, avoid deploying <code>node_modules</code> to shared hosting, and clear old backups and cache directories. Check the inode count in the panel's usage section — it is reported separately from disk space.</>}
reference={{label: 'Files', href: '/knowledge-base/hosting/cpanel#files'}}
/>

<Quiz
question="Which practices are correct on cPanel shared hosting?"
type="multiple"
options={[
{text: 'Sending transactional email through a dedicated provider rather than the local mail server', correct: true, why: 'You share an outbound IP with every other account, so one spammer on the server damages your deliverability. A provider also gives you logs and bounce handling.'},
{text: 'Configuring SPF, DKIM and DMARC for the domain', correct: true, why: 'All three are needed for mail to be accepted reliably, and cPanel\'s Email Deliverability section reports what is missing.'},
{text: 'Keeping .env and config files outside public_html', correct: true, why: 'A file inside the web root can be served as plain text if PHP stops executing, exposing database credentials and API keys.'},
{text: 'Running a persistent queue:work daemon for background jobs', why: 'Process limits kill long-running daemons. Use cron with queue:work --stop-when-empty, or move to a VPS.'},
{text: 'Enabling remote MySQL access so you can use a local GUI', why: 'It exposes the database to the internet for convenience. Use an SSH tunnel instead where shell access exists.'},
]}
explanation={<>The recurring theme on shared hosting: work within the process and privilege limits rather than against them, and move the pieces that genuinely need a server to a VPS.</>}
reference={{label: "Do's and Don'ts", href: '/knowledge-base/hosting/cpanel#dos-and-donts'}}
/>

<Quiz
question="A cron job runs correctly when executed by hand over SSH but produces nothing when scheduled. What should you check first?"
options={[
{
text: 'Absolute paths — cron runs with a minimal PATH, so the interpreter and script must be fully qualified, and the CLI PHP binary may differ from the web one',
correct: true,
why: 'Your interactive shell has a rich environment that cron does not. A bare php or a relative script path resolves in one and not the other.',
},
{text: 'The cron interval is too short for the host to allow', why: 'Worth knowing — many hosts enforce a minimum — and it would still produce some runs.'},
{text: 'Cron jobs require the account to be logged in', why: 'Cron runs independently of any login session.'},
{text: 'The script needs execute permissions on the PHP binary', why: 'The binary is executable system-wide; invoking it explicitly is the normal pattern.'},
]}
explanation={<>Remove the output redirect temporarily so cron emails you the error — that message usually names the problem directly. Then restore <code>&gt;/dev/null 2&gt;&amp;1</code> so successful runs stay quiet.</>}
reference={{label: 'Cron', href: '/knowledge-base/hosting/cpanel#cron'}}
/>

---

## References

- [cPanel Documentation](https://docs.cpanel.net/) — the full product reference.
- [cPanel User Guide](https://docs.cpanel.net/cpanel/) — feature-by-feature
  walkthroughs.
- [AutoSSL documentation](https://docs.cpanel.net/whm/ssl-tls/manage-autossl/) —
  issuance, renewal and troubleshooting.
- [Email Deliverability in cPanel](https://docs.cpanel.net/cpanel/email/email-deliverability/)
  — SPF, DKIM and DMARC configuration.
- [PHP: Runtime Configuration](https://www.php.net/manual/en/ini.list.php) —
  what each INI directive does.
- [VPS](/knowledge-base/hosting/vps) — where to go when the constraints stop
  fitting.
