---
title: 'VPS'
description: 'Provisioning and hardening your own virtual server — users, SSH, firewall, systemd, patching, monitoring and backups.'
---

# VPS

## Introduction

A virtual private server is a slice of a physical machine with its own operating
system, running under a hypervisor. You get root, and with it every
responsibility a system administrator has.

**This is the trade you are making.** A platform-as-a-service handles patching,
process supervision, TLS renewal, log rotation and restarts. A VPS hands you all
of that, plus considerably more capability per pound.

**When a VPS is the right choice:**

- You need control the platform will not give you — specific runtimes,
  background daemons, custom networking.
- Cost matters at scale: a €5/month server outperforms many $50/month PaaS
  tiers.
- You are running something long-lived — a WebSocket server, a queue worker, a
  database — that maps badly onto request-scoped platforms.

**When it is not:**

- Nobody on the team wants to be responsible for security patches.
- The application is genuinely stateless and small, and a platform's free tier
  covers it.

**The honest cost is time.** Budget an afternoon for the initial setup, then an
hour a month for updates and checks. That is a fair trade at scale and a poor
one for a side project.

---

## Initial Setup

Run these on a fresh server, in this order, before anything else.

### 1. Update everything

```bash
apt update && apt upgrade -y
```

### 2. Create a non-root user

```bash
adduser deploy
usermod -aG sudo deploy
```

### 3. Copy your SSH key to that user

From your **local** machine:

```bash
ssh-copy-id deploy@203.0.113.10
ssh deploy@203.0.113.10   # confirm it works BEFORE the next step
```

**Confirm key login works before disabling password authentication.** Getting
this order wrong locks you out, and recovery means a provider console session.

### 4. Harden SSH

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

```bash
sudo sshd -t && sudo systemctl restart ssh
```

**Keep your existing session open** while you test a new one in a second
terminal. `sshd -t` validates the config first, which catches the typo that
would otherwise end your access.

**Changing the SSH port is theatre**, not security — it reduces log noise from
automated scanners and stops nothing that matters. Key-only authentication is
what protects you. See [SSH](/knowledge-base/ssh).

### 5. Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
sudo ufw status verbose
```

**Allow SSH before enabling the firewall.** The other classic lockout.

**Deny by default and open only what is needed.** In particular, never expose a
database port to the internet — bind it to `127.0.0.1` and reach it over an SSH
tunnel or a private network.

### 6. Automatic security updates

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

```
// /etc/apt/apt.conf.d/50unattended-upgrades
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
```

**Unattended security upgrades are the single highest-value setting on this
page.** The overwhelming majority of compromised servers were running a package
with a published patch.

### 7. Fail2ban (optional but cheap)

```bash
sudo apt install fail2ban
sudo systemctl enable --now fail2ban
```

With password authentication already disabled it mostly reduces log volume, and
it is useful in front of application login endpoints.

---

## Process Supervision with systemd

Your application must start on boot and restart when it crashes. `systemd` does
this; `nohup ... &` does not.

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My application
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/srv/myapp
Environment=NODE_ENV=production
EnvironmentFile=/etc/myapp/env
ExecStart=/usr/bin/node /srv/myapp/server.js
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/myapp/storage

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now myapp
sudo systemctl status myapp
journalctl -u myapp -f
```

**Key directives:**

| Directive              | Why it matters                                           |
| ---------------------- | -------------------------------------------------------- |
| `Restart=always`       | The crash-recovery you are here for                      |
| `RestartSec=5`         | Prevents a tight restart loop from consuming the machine |
| `User=deploy`          | Never run an application as root                         |
| `EnvironmentFile`      | Secrets in a `chmod 600` file, not in the unit           |
| `ProtectSystem=strict` | Filesystem is read-only except `ReadWritePaths`          |
| `NoNewPrivileges`      | The process cannot gain privileges via setuid            |

**Logs go to the journal automatically** — no log file to rotate, and
`journalctl -u myapp --since "1 hour ago"` is available immediately. Set
`SystemMaxUse=1G` in `/etc/systemd/journald.conf` to bound its disk use.

**Timers replace cron** and are worth the switch: they log to the journal,
support `Persistent=true` for missed runs, and can depend on other units.

---

## The Runtime Stack

A typical server runs:

```
Internet → ufw → Nginx (TLS, static files) → your app on 127.0.0.1:3000
                                            → managed by systemd
```

- **[Nginx](/knowledge-base/hosting/nginx)** terminates TLS and proxies to your
  application. **Bind the application to `127.0.0.1`**, never `0.0.0.0`, so the
  only way in is through Nginx.
- **Certbot** issues and renews certificates automatically. See
  [SSL/TLS](/knowledge-base/hosting/ssl-tls).
- **A database** — local for small deployments, managed once you value
  automated backups and failover more than the saving.
- **[Docker](/knowledge-base/docker)**, optionally, if you prefer to ship images
  rather than manage runtimes on the host.

---

## Sizing

**Start small and resize.** Every provider allows vertical scaling in minutes,
and almost every team over-provisions initially.

| Workload                      | Reasonable start |
| ----------------------------- | ---------------- |
| Static site, low-traffic API  | 1 vCPU, 1 GB     |
| Typical web app + database    | 2 vCPU, 4 GB     |
| Busier app, separate database | 4 vCPU, 8 GB     |

**Memory is what actually runs out.** CPU throttles and slows down; memory
exhaustion invokes the OOM killer, which terminates whichever process it judges
worst — frequently your database.

**Always configure swap**, even a small amount. It converts a hard OOM kill into
degraded performance you can notice and act on:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Watch disk too.** A full disk breaks everything simultaneously and confusingly
— databases stop writing, logs stop rotating, deploys fail. Logs and Docker
images are the usual culprits.

---

## Backups

**A server you cannot rebuild is a liability.** Two separate things are needed,
and provider snapshots alone are not enough.

**1. Provider snapshots** — whole-disk images, usually a few pounds a month.
Excellent for "I broke the server", useless for "a row was deleted three weeks
ago".

**2. Data backups** — database dumps and user uploads, off the server:

```bash
#!/bin/bash
set -euo pipefail
STAMP=$(date +%F-%H%M)
pg_dump -Fc myapp > "/tmp/db-$STAMP.dump"
restic -r "$RESTIC_REPO" backup "/tmp/db-$STAMP.dump" /srv/myapp/storage
restic -r "$RESTIC_REPO" forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
rm "/tmp/db-$STAMP.dump"
```

**Off the server is the important part.** A backup on the same disk does not
survive the failure it exists for.

**Test the restore.** An untested backup is a hypothesis. Restore into a scratch
server once a quarter and confirm the data is actually there — this is where
people discover the dump has been zero bytes for six months.

---

## Deployment

**Simplest that works — pull and restart:**

```bash
#!/bin/bash
set -euo pipefail
cd /srv/myapp
git fetch --all
git reset --hard origin/main
npm ci --omit=dev
npm run build
sudo systemctl restart myapp
```

Brief downtime during the restart. Fine for most applications.

**Zero-downtime, without containers** — release directories and a symlink
switch:

```
/srv/myapp/releases/2026-08-03-1420/
/srv/myapp/current -> releases/2026-08-03-1420
```

Build the new release fully, switch the symlink, reload. Rollback is switching
the symlink back — which is the real benefit.

**With Docker**, run two containers and shift Nginx upstream between them, or
use `docker compose up -d` with a health check and a rolling policy.

**Drive it from CI** rather than by hand. See
[CI/CD](/knowledge-base/hosting/ci-cd) and
[GitHub Actions](/knowledge-base/hosting/github-actions) — a deploy that only
one person knows how to run is an availability risk.

---

## Monitoring

You need to know about a problem before your users report it.

**The minimum:**

- **Uptime check** from outside — UptimeRobot, Better Stack, Healthchecks.io.
  Free, and it catches total failures.
- **Disk-space alert.** The most common self-inflicted outage.
- **Error tracking** in the application — Sentry or equivalent.

**Quick manual checks:**

```bash
df -h                          # disk
free -h                        # memory and swap
systemctl --failed             # anything crashed
journalctl -p err -since today # today's errors
uptime                         # load average
```

For anything more, see [Monitoring](/knowledge-base/operations/monitoring) and
[Observability](/knowledge-base/operations/observability).

---

## Do's and Don'ts

### Do

- Create a non-root user with sudo, and disable root SSH login.
- Confirm key-based login works _before_ disabling passwords.
- Allow SSH _before_ enabling the firewall.
- Enable unattended security upgrades.
- Run the application under systemd with `Restart=always`.
- Bind application and database ports to `127.0.0.1`.
- Configure swap, even on a large server.
- Back up off the server, and test a restore.
- Set an external uptime check and a disk-space alert.
- Script the deploy so it is reproducible.

### Don't

- Don't run the application as root.
- Don't expose database ports to the internet.
- Don't rely on `nohup` or `screen` for a production process.
- Don't skip patching because uptime looks good.
- Don't keep backups only on the server they came from.
- Don't edit files on the server directly instead of deploying.
- Don't over-provision at the start — resizing takes minutes.
- Don't assume a provider snapshot is a data backup.

---

## Common Mistakes

**Locking yourself out.** Disabling password auth before testing keys, or
enabling `ufw` without allowing SSH. Keep a second session open, and know where
your provider's console is.

**Running as root.** Then an application vulnerability is a full server
compromise instead of a contained one.

**Exposing PostgreSQL or MySQL on `0.0.0.0`.** Automated scanners find it within
hours. Bind to localhost.

**No process supervision.** The app runs until it crashes at 3 a.m. and stays
down until someone notices.

**Never patching.** The most common route to a compromised server, and entirely
preventable.

**Untested backups.** Discovered at the worst possible moment.

**Disk full from logs.** Set `SystemMaxUse` on the journal and rotate
application logs.

**Configuration only on the server.** Nobody can rebuild it. Keep unit files,
Nginx config and deploy scripts in version control.

---

## Debugging

| Symptom                     | Where to look                                               |
| --------------------------- | ----------------------------------------------------------- |
| App not responding          | `systemctl status myapp`, `journalctl -u myapp -n 100`      |
| Port not reachable          | `ss -tlnp` (listening?), `ufw status` (allowed?)            |
| Killed unexpectedly         | `journalctl -k \| grep -i oom` — out of memory              |
| Everything failing at once  | `df -h` — the disk is full                                  |
| Slow under load             | `top`, `iostat -x 1`, check swap usage                      |
| Service won't start on boot | `systemctl is-enabled myapp`                                |
| SSH refused                 | Provider console; check `sshd` and firewall rules           |
| Certificate expired         | `systemctl status certbot.timer`, `certbot renew --dry-run` |

**`journalctl -xe` immediately after a failed start** is usually the fastest
route to the cause — it shows the failure with systemd's own explanation
attached.

---

## FAQ

**VPS or managed platform?**
Platform for speed and low operational load; VPS for control and cost at scale.
Many teams run a VPS for the application and a managed service for the database
— the database is where operational mistakes hurt most.

**Which provider?**
[Hetzner](/knowledge-base/hosting/hetzner) for value,
[DigitalOcean](/knowledge-base/hosting/digitalocean) for documentation and
simplicity, [AWS](/knowledge-base/hosting/aws) when you need the wider
ecosystem.

**Should I use Docker on a VPS?**
It makes deploys reproducible and rollbacks trivial, at the cost of another
layer to understand. Worth it for multi-service applications; optional for a
single process.

**How do I handle secrets?**
An `EnvironmentFile` owned by root with mode `600`, or a secrets manager. Never
in the repository, and never in the systemd unit itself, which is world-readable.

**Do I need a load balancer?**
Not until one server is insufficient or you need zero-downtime deploys. Add it
when the requirement is real.

**How much maintenance is this really?**
An hour or two a month once set up: check updates applied, disks are healthy and
backups restored. Less if you automate the checks.

---

## Check your understanding

<Quiz
question="A developer sets up a new server, edits sshd_config to disable password authentication, restarts SSH, and is then locked out. What was skipped?"
options={[
{
text: 'Confirming that key-based login actually worked, in a separate session, before disabling passwords',
correct: true,
why: 'Once passwords are off, a missing or misplaced key leaves no way in over SSH — recovery requires the provider console.',
},
{text: 'Changing the SSH port first', why: 'The port is unrelated to authentication, and moving it is log-noise reduction rather than security.'},
{text: 'Installing fail2ban', why: 'That blocks brute-force attempts; it does not affect your own ability to log in.'},
{text: 'Creating a firewall rule for SSH', why: 'A plausible second lockout cause, but not this one — the change was to authentication.'},
]}
explanation={<>The rule for both classic lockouts: keep your current session open, make the change, and verify from a <em>second</em> terminal. <code>sshd -t</code> before restarting catches config typos, and <code>ufw allow OpenSSH</code> must come before <code>ufw enable</code>.</>}
reference={{label: 'Initial setup', href: '/knowledge-base/hosting/vps#initial-setup'}}
/>

<Quiz
question="An application on a VPS is started with `nohup node server.js &`. It works, but the site is down every few days until someone SSHs in and restarts it. What is the fix?"
options={[
{
text: 'Run it as a systemd service with Restart=always, so it restarts on crash and starts on boot',
correct: true,
why: 'nohup gives no supervision — nothing restarts the process when it exits or when the machine reboots.',
},
{text: 'Add more memory to the server', why: 'It may reduce crashes; it does not make the service come back when one happens.'},
{text: 'Put the process in a screen session', why: 'screen keeps a terminal alive; it still does not restart a process that has exited.'},
{text: 'Add a cron job that starts the app every five minutes', why: 'A crude workaround that risks duplicate processes and gives no logs or dependency ordering.'},
]}
explanation={<>Add <code>RestartSec=5</code> as well, so a process that fails immediately does not spin in a tight restart loop. Logs then go to the journal automatically — <code>journalctl -u myapp -f</code> — with nothing to rotate.</>}
reference={{label: 'Process supervision with systemd', href: '/knowledge-base/hosting/vps#process-supervision-with-systemd'}}
/>

<Quiz
question="A server with 2 GB of RAM and no swap runs an app and a PostgreSQL database. Under a traffic spike, the database process disappears with no application error. What happened?"
options={[
{
text: 'The kernel OOM killer terminated PostgreSQL when memory was exhausted',
correct: true,
why: 'Without swap, memory exhaustion is immediate and the kernel kills whichever process it scores worst — often the database, because it is the largest.',
},
{text: 'PostgreSQL crashed due to too many connections', why: 'That produces connection errors in the logs rather than a silently vanished process.'},
{text: 'The disk filled up', why: 'A full disk stops writes and logs errors; it does not remove the process.'},
{text: 'systemd restarted it during a package upgrade', why: 'A restart would be logged, and the service would come back.'},
]}
explanation={<>Confirm with <code>journalctl -k | grep -i oom</code>. Configure swap even on servers you expect to have plenty of memory — it converts a hard kill into degraded performance you can observe and act on. Memory, not CPU, is what usually runs out.</>}
reference={{label: 'Sizing', href: '/knowledge-base/hosting/vps#sizing'}}
/>

<Quiz
question="Which of these belong in a production VPS setup?"
type="multiple"
options={[
{text: 'Unattended security upgrades with a scheduled reboot window', correct: true, why: 'Most compromised servers were running a package with a published patch available.'},
{text: 'Binding the application and database to 127.0.0.1', correct: true, why: 'The only route in should be through the reverse proxy; exposed database ports are found by scanners within hours.'},
{text: 'Backups stored off the server, with a periodically tested restore', correct: true, why: 'A backup on the same disk does not survive the failure it exists for, and an untested backup is only a hypothesis.'},
{text: 'A provider snapshot as the only backup', why: 'Snapshots recover a broken server, not a row deleted three weeks ago. They complement data backups rather than replacing them.'},
{text: 'Running the app as root so it can bind port 80 directly', why: 'An application vulnerability then becomes a full server compromise. Bind high and let Nginx hold 80/443.'},
]}
explanation={<>The through-line is blast radius: patch so you are not exploited, unprivileged so an exploit is contained, backed up so a loss is recoverable.</>}
reference={{label: "Do's and Don'ts", href: '/knowledge-base/hosting/vps#dos-and-donts'}}
/>

<Quiz
question="A VPS starts failing in several unrelated ways at once — deploys fail, the database refuses writes, and log files stop updating. What should you check first?"
options={[
{
text: 'Disk space with df -h',
correct: true,
why: 'A full disk breaks everything that writes, simultaneously and confusingly. The scattered, unrelated symptoms are the signature.',
},
{text: 'CPU load with top', why: 'High CPU makes things slow rather than causing writes to fail outright.'},
{text: 'Network connectivity', why: 'A network problem would not stop local database writes.'},
{text: 'The systemd journal for application errors', why: 'Worth reading, though journal writes are themselves failing when the disk is full.'},
]}
explanation={<>Logs and Docker images are the usual culprits. Bound the journal with <code>SystemMaxUse</code> in <code>/etc/systemd/journald.conf</code>, rotate application logs, prune unused images, and set a disk-space alert so you learn about it at 80% rather than 100%.</>}
reference={{label: 'Debugging', href: '/knowledge-base/hosting/vps#debugging'}}
/>

---

## References

- [systemd.service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
  — every unit directive, including the hardening options.
- [systemd.exec hardening](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
  — `ProtectSystem`, `PrivateTmp` and the rest.
- [Ubuntu Server documentation](https://documentation.ubuntu.com/server/) —
  official guides for firewall, users and packages.
- [DigitalOcean: Initial Server Setup](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-22-04)
  — a well-maintained walkthrough of the first-hour steps.
- [restic documentation](https://restic.readthedocs.io/) — deduplicating,
  encrypted backups to almost any storage backend.
- [SSH](/knowledge-base/ssh) — keys, agents and config beyond the basics.
