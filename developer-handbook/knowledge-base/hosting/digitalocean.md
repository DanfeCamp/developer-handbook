---
title: 'DigitalOcean'
description: 'Simple cloud hosting with predictable pricing — Droplets, managed databases, Spaces, App Platform and Kubernetes.'
---

# DigitalOcean

## Introduction

DigitalOcean offers a deliberately smaller surface than AWS: virtual machines,
object storage, managed databases, and a git-based deploy platform. That
restraint is the product.

**What you are choosing:**

- **Predictable pricing.** Flat monthly rates, generous bundled transfer, and a
  bill you can estimate before you build.
- **A comprehensible console.** You can find things.
- **Genuinely good documentation.** DigitalOcean's tutorials are used by people
  running on entirely different providers, which tells you something.

**What you give up:** the breadth. No equivalent of Lambda's ecosystem, fewer
regions, fewer compliance certifications, no exotic managed services. If you
need those, you need [AWS](/knowledge-base/hosting/aws).

**Where it fits:** the default recommendation for a small-to-medium application
where the team wants managed backups and a load balancer without an
infrastructure specialist. Cheaper than AWS, more capable than shared hosting,
better documented than either.

---

## Droplets

Virtual machines. Everything on the [VPS page](/knowledge-base/hosting/vps)
applies — non-root user, key-only SSH, firewall, systemd, unattended upgrades.

**Types:**

| Type                    | Notes                                          |
| ----------------------- | ---------------------------------------------- |
| **Basic (shared CPU)**  | Cheapest; CPU is shared and can be throttled   |
| **Premium Intel / AMD** | Newer CPUs, NVMe storage, modest premium       |
| **General Purpose**     | Dedicated CPU, balanced memory                 |
| **CPU-Optimized**       | Dedicated CPU, less memory — builds, video, CI |
| **Memory-Optimized**    | Large RAM — databases, caches                  |

**Start on a Basic Droplet.** Move to dedicated CPU only when you observe steal
time (`st` in `top`) — that is the actual signal that shared CPU is hurting you,
rather than a guess.

**Resizing:** CPU and RAM can be increased and decreased. **Disk growth is
permanent** — you can never shrink it, which quietly locks in a price floor.
Keep data on Volumes instead, which resize freely and detach from a Droplet
entirely.

**Snapshots** cost a small amount per GB per month and are the fastest rollback
you have. Take one before any risky change; delete it when the change proves
fine.

**Backups** (weekly or daily, 20% of the Droplet price) are automatic and
retained on a schedule. They recover a broken server, not a row deleted three
weeks ago — you still need data backups off the machine.

---

## Managed Databases

PostgreSQL, MySQL, Redis/Valkey, MongoDB and Kafka, with backups, patching,
failover and metrics handled.

**Worth paying for.** The premium over self-hosting on a Droplet buys you
point-in-time recovery and automatic failover — the two things people most
regret not having.

**Configuration that matters:**

- **Trusted sources.** Restrict access to specific Droplets or IPs rather than
  leaving the database open to any address with the password. This is the
  equivalent of an AWS security group, and it is off until you set it.
- **Connection pooling** is built in and you should use it. Managed PostgreSQL
  has modest connection limits, and a pool in `transaction` mode multiplies
  effective capacity. Note that transaction mode disables session-level features
  — prepared statements, `LISTEN/NOTIFY`, advisory locks held across statements.
- **Standby nodes** add automatic failover. Single-node databases have a
  maintenance window during which they are unavailable.
- **Private network connections.** Use the VPC-internal hostname, not the public
  one: it does not count against bandwidth and never traverses the internet.

**Point-in-time recovery** covers the last seven days on most plans — the
feature that turns a bad migration into a bad afternoon.

---

## Spaces

S3-compatible object storage with a bundled CDN. Any AWS SDK works against it
with a changed endpoint.

```js
import {S3Client} from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: 'https://lon1.digitaloceanspaces.com',
  region: 'lon1',
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
});
```

**Pricing is a flat monthly base including storage and transfer**, then a modest
per-GB rate beyond it. Substantially cheaper than S3 for media-heavy sites, and
much easier to predict.

**The CDN is included** — enable it and serve assets from the edge endpoint
rather than the origin one. Presigned URLs work exactly as they do with S3, so
the upload pattern on the [AWS page](/knowledge-base/hosting/aws#s3) transfers
unchanged.

---

## App Platform

Git-based deploys with no server to manage: connect a repository, App Platform
builds and runs it, with TLS, a CDN and health checks included.

**Good for:** straightforward web applications, APIs, static sites, and workers
that want a platform rather than a machine.

**Constraints:** a fixed build environment, limited runtime control, no
long-lived background processes outside the defined worker type, and per-app
pricing that overtakes Droplets as you scale.

**The pragmatic split many teams land on:** App Platform for the application, a
managed database for the data. No servers to patch, and no operational
responsibility for the part where mistakes hurt most.

---

## Networking

**VPC** — every account gets a private network per region. **Use private
addresses for internal traffic**: it does not count against bandwidth, and it
keeps database traffic off the internet.

**Cloud Firewalls** are network-level rules applied to Droplets by tag, separate
from and complementary to `ufw` on the host. Tag-based rules are the useful
part: a rule that lets `tag:web` reach `tag:db` keeps working as you add
Droplets.

**Reserved IPs** are static addresses you can remap between Droplets in seconds
— the mechanism for a manual blue-green cutover or a fast failover.

**Load Balancers** are around $12/month with health checks, TLS termination and
sticky sessions. Add one when you have more than one Droplet, or when you want
zero-downtime deploys.

**Bandwidth is pooled across the account** and generous — 1 TB or more per
Droplet. Overage is billed per GB, and the pooling means a quiet Droplet
subsidises a busy one.

---

## Kubernetes

DOKS is managed Kubernetes with a free control plane — you pay only for the
worker nodes.

**Use it if** you already know Kubernetes, or you genuinely have many services
that need orchestrating.

**Don't use it because it sounds correct.** For one application and a database,
Kubernetes adds a large operational surface for no benefit. A Droplet with
systemd, or App Platform, is the right answer far more often than teams admit.

---

## Cost

| Resource                 | Typical monthly      |
| ------------------------ | -------------------- |
| Basic Droplet, 1 GB      | ~$6                  |
| Basic Droplet, 4 GB      | ~$24                 |
| Managed PostgreSQL, 1 GB | ~$15                 |
| Load Balancer            | ~$12                 |
| Spaces (base)            | ~$5                  |
| Droplet backups          | 20% of Droplet price |

**A small production setup** — a 2 GB Droplet, a managed database, Spaces and
backups — lands around $40–50/month, with no meaningful variance. That
predictability is worth real money to a small team, and it is the main reason
people choose DigitalOcean over AWS.

**Set a billing alert anyway.** Managed databases and load balancers accumulate
quietly.

---

## Do's and Don'ts

### Do

- Harden every Droplet as on the [VPS page](/knowledge-base/hosting/vps).
- Restrict managed databases to trusted sources.
- Use private VPC addresses for internal traffic.
- Enable connection pooling on managed PostgreSQL.
- Snapshot before risky changes.
- Keep data on Volumes rather than growing the Droplet disk.
- Use Cloud Firewalls with tags alongside host firewalls.
- Enable the Spaces CDN for public assets.
- Add a standby node to production databases.
- Set billing alerts.

### Don't

- Don't leave a managed database reachable from any address.
- Don't rely on Droplet backups as your only data backup.
- Don't grow the Droplet disk expecting to shrink it later.
- Don't send internal traffic over public IPs.
- Don't reach for Kubernetes for a single application.
- Don't use `transaction` pooling with code that needs session state.
- Don't skip the load balancer if you need zero-downtime deploys.

---

## Common Mistakes

**A managed database open to the world.** Trusted sources are not configured by
default. A password is not a network boundary.

**Treating Droplet backups as data backups.** They restore a server, not a
deleted record. Take database dumps off the machine as well.

**Growing the disk to store uploads.** Permanent, and the price never comes
down. Use Volumes or Spaces.

**Internal traffic over public IPs.** Counts against bandwidth and leaves the
private network. Use the VPC hostname.

**Transaction pooling with prepared statements.** Fails intermittently and
confusingly under load. Match the pool mode to what your driver needs.

**Ignoring steal time.** A shared-CPU Droplet under a noisy neighbour looks like
an application performance problem until you check `top`.

**No swap on a small Droplet.** The OOM killer takes the database. See
[Sizing](/knowledge-base/hosting/vps#sizing).

---

## Debugging

| Symptom                           | Where to look                                        |
| --------------------------------- | ---------------------------------------------------- |
| Cannot reach the database         | Trusted sources; VPC membership; the right hostname  |
| Slow but idle application         | `top` — steal time on a shared-CPU Droplet           |
| Connections exhausted             | Enable pooling; check for leaked connections         |
| Deploy fails on App Platform      | Build logs; the build environment differs from local |
| Site unreachable, Droplet running | Cloud Firewall _and_ `ufw` — both apply              |
| Bandwidth overage                 | Internal traffic on public IPs                       |
| Spaces 403                        | Key permissions, or an object that is not public     |

**The doubled firewall catches people regularly.** Cloud Firewall rules and host
`ufw` rules are independent, and a packet must pass both. Check each separately
before concluding the application is at fault.

---

## FAQ

**DigitalOcean or AWS?**
DigitalOcean if you want a predictable bill and a small surface. AWS if you need
a specific service, wider regions or compliance certifications. Migration
between them is real work but not exotic — both are ordinary Linux underneath.

**DigitalOcean or Hetzner?**
[Hetzner](/knowledge-base/hosting/hetzner) is materially cheaper for equivalent
specifications. DigitalOcean has more regions, better documentation and a
broader managed-service set. If cost dominates, Hetzner; if you want managed
databases and App Platform, DigitalOcean.

**Droplet or App Platform?**
App Platform to avoid operations entirely; Droplet when you need control or the
price at scale.

**Is Spaces really S3-compatible?**
For the common operations, yes. Some newer S3 APIs are absent, so check anything
unusual against their documentation.

**Do I need a load balancer with one Droplet?**
Only for zero-downtime deploys or TLS termination you would rather not manage.
Otherwise Nginx on the Droplet is enough.

**Are the tutorials trustworthy?**
Generally yes, and check the Ubuntu version and dates — the older ones
occasionally recommend superseded approaches.

---

## Check your understanding

<Quiz
question="A team creates a managed PostgreSQL database on DigitalOcean and connects with a strong password. What have they most likely not configured?"
options={[
{
text: 'Trusted sources — until set, the database accepts connections from any address on the internet',
correct: true,
why: 'Managed databases are reachable publicly by default and restricted only when you nominate specific Droplets, tags or IPs. A password is authentication, not a network boundary.',
},
{text: 'TLS on the connection', why: 'Managed databases require TLS by default, so this is already handled.'},
{text: 'Automated backups', why: 'Backups are enabled by default on managed databases.'},
{text: 'A standby node', why: 'Worth adding for failover, and it is not a security exposure.'},
]}
explanation={<>Restrict to trusted sources and connect over the private VPC hostname — internal traffic then never traverses the internet and does not count against bandwidth.</>}
reference={{label: 'Managed databases', href: '/knowledge-base/hosting/digitalocean#managed-databases'}}
/>

<Quiz
question="An application on a Basic Droplet is slow, but CPU usage appears low and there is plenty of free memory. What should you check?"
options={[
{
text: 'Steal time in top — a shared-CPU Droplet under a noisy neighbour has cycles taken by other tenants',
correct: true,
why: 'Steal time is CPU the hypervisor gave to another guest. Your process is ready to run and not being scheduled, so utilisation looks low while everything feels slow.',
},
{text: 'Disk space with df -h', why: 'Worth checking generally, and a full disk causes write failures rather than uniform slowness.'},
{text: 'Whether backups are running', why: 'Backups are snapshot-based and do not produce sustained slowdown.'},
{text: 'The number of open file descriptors', why: 'That produces errors on new connections, not general sluggishness.'},
]}
explanation={<>Sustained steal time is the actual signal that shared CPU is hurting you — move to a Premium or dedicated-CPU Droplet then, rather than guessing in advance.</>}
reference={{label: 'Droplets', href: '/knowledge-base/hosting/digitalocean#droplets'}}
/>

<Quiz
question="Which statements about DigitalOcean Droplet storage are correct?"
type="multiple"
options={[
{text: 'Droplet disk size can be increased but never decreased', correct: true, why: 'Disk growth is permanent, which quietly locks in a price floor for the life of the Droplet.'},
{text: 'Volumes can be resized and moved between Droplets', correct: true, why: 'Which is why user uploads and data belong on a Volume or in Spaces rather than the Droplet disk.'},
{text: 'Snapshots are the fastest way to roll back a risky change', correct: true, why: 'Take one before the change and delete it once the change proves fine.'},
{text: 'Droplet backups are a sufficient data backup strategy', why: 'They restore a broken server, not a record deleted three weeks ago. Take database dumps off the machine too.'},
{text: 'Spaces storage counts against the Droplet disk quota', why: 'Spaces is separate object storage with its own pricing, unrelated to Droplet disks.'},
]}
explanation={<>Keep the Droplet disk for the operating system and application, and put anything that grows — uploads, media, backups — on a Volume or in Spaces.</>}
reference={{label: 'Droplets', href: '/knowledge-base/hosting/digitalocean#droplets'}}
/>

<Quiz
question="A Droplet is running and healthy, but the site is unreachable from outside. `ufw status` shows ports 80 and 443 allowed. What else should you check?"
options={[
{
text: 'The Cloud Firewall — it is a separate network-level layer, and a packet must pass both it and ufw',
correct: true,
why: 'Cloud Firewalls and host firewalls are independent. Allowing a port in one does nothing if the other still blocks it.',
},
{text: 'Whether the Droplet has a reserved IP attached', why: 'A reserved IP changes which address reaches the Droplet; the public IP works regardless.'},
{text: 'Whether the Droplet is in a VPC', why: 'Every Droplet is in a VPC, and that does not block public inbound traffic.'},
{text: 'The snapshot schedule', why: 'Unrelated to network reachability.'},
]}
explanation={<>Check both layers separately before concluding the application is at fault. Tag-based Cloud Firewall rules are the useful pattern — a rule letting <code>tag:web</code> reach <code>tag:db</code> keeps working as you add Droplets.</>}
reference={{label: 'Networking', href: '/knowledge-base/hosting/digitalocean#networking'}}
/>

<Quiz
question="A team enables transaction-mode connection pooling on managed PostgreSQL. Prepared statements start failing intermittently under load. Why?"
options={[
{
text: 'Transaction mode returns a connection to the pool after each transaction, so session-level state such as prepared statements does not persist',
correct: true,
why: 'Transaction pooling multiplexes many clients onto few connections, which means anything scoped to a session — prepared statements, LISTEN/NOTIFY, advisory locks held across statements — is unreliable.',
},
{text: 'The pool size is too small', why: 'That produces waits and timeouts, not statements that vanish.'},
{text: 'Prepared statements are unsupported by managed PostgreSQL', why: 'They are fully supported; it is the pooling mode that breaks the assumption.'},
{text: 'TLS renegotiation invalidates the statements', why: 'TLS operates below the protocol and does not affect session state.'},
]}
explanation={<>Match the pool mode to what your driver needs: <code>session</code> mode preserves session state at the cost of concurrency, and many drivers can disable prepared statements to make <code>transaction</code> mode safe.</>}
reference={{label: 'Managed databases', href: '/knowledge-base/hosting/digitalocean#managed-databases'}}
/>

---

## References

- [DigitalOcean Documentation](https://docs.digitalocean.com/) — the product
  reference.
- [DigitalOcean Community Tutorials](https://www.digitalocean.com/community/tutorials)
  — widely used well beyond DigitalOcean itself.
- [Managed Databases documentation](https://docs.digitalocean.com/products/databases/)
  — pooling, standby nodes and trusted sources.
- [Spaces documentation](https://docs.digitalocean.com/products/spaces/) —
  S3 compatibility and CDN configuration.
- [App Platform documentation](https://docs.digitalocean.com/products/app-platform/)
  — build environments, workers and limits.
- [Pricing](https://www.digitalocean.com/pricing) — flat rates, easily estimated.
