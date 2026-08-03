---
title: 'Hetzner'
description: 'Cost-effective cloud and dedicated servers — instance types, networking, storage, and what you take on in exchange for the price.'
---

# Hetzner

## Introduction

Hetzner is a German hosting provider offering substantially more CPU and memory
per unit cost than the large clouds — commonly three to five times the resources
for the same money.

**That is the entire proposition, and it is real.** A €4/month Hetzner instance
gives you 2 vCPU and 4 GB of RAM; the equivalent at a major cloud costs several
times that. For teams paying their own bills, the difference is not marginal.

**What you take on in exchange:**

- **Few managed services.** There is no managed PostgreSQL, no managed Redis, no
  serverless platform. You run those yourself on a server.
- **Fewer regions.** Germany, Finland, Singapore and the US. Excellent for
  European users, less so for a genuinely global audience.
- **A smaller ecosystem.** Good API, good Terraform provider, and far fewer
  integrations than AWS.
- **Stricter account verification.** New accounts are sometimes asked for
  identification, and this surprises people mid-signup.

**Who it suits:** teams comfortable administering Linux who want to spend less.
Combine it with the [VPS page](/knowledge-base/hosting/vps) — that page is the
operational half of using Hetzner well.

---

## Cloud Servers

Virtual machines, billed hourly with a monthly cap.

| Line                     | Notes                                              |
| ------------------------ | -------------------------------------------------- |
| **CX (Intel, shared)**   | Cheapest; fine for most web workloads              |
| **CPX (AMD, shared)**    | More cores, modest premium                         |
| **CAX (Arm64, shared)**  | **Best value on the platform** — check your images |
| **CCX (dedicated vCPU)** | Guaranteed cores; no steal time                    |

**The Arm instances are exceptionally cheap** and most modern software has
Arm64 builds. Verify your dependencies — an old native Node module or a
`linux/amd64`-only Docker image will stop you, and it is worth checking before
committing.

**Traffic is generous:** 20 TB per month included on most plans, then a low
per-TB rate. This is where Hetzner differs most sharply from AWS, whose egress
charges frequently exceed the compute bill.

**Backups** cost 20% of the server price and take automatic snapshots on a
rotating schedule. **Snapshots** are manual, priced per GB, and are your
pre-change rollback.

**Rescue mode** boots a recovery Linux over the network with your disk attached —
the way out of a broken kernel, a bad `fstab` or a firewall lockout. Learn where
it is before you need it.

---

## Dedicated Servers

Hetzner also rents physical machines, and this is where the price advantage
becomes extreme — a dedicated server with 64 GB of RAM and NVMe storage costs
less than a mid-sized cloud instance elsewhere.

**Two routes:**

- **Server auction** — used hardware at steep discounts, available immediately,
  varying specifications.
- **New dedicated** — current hardware, a one-off setup fee, monthly thereafter.

**The trade-offs are real.** A physical machine can fail, and recovery means a
support ticket and hardware replacement rather than a new instance in ninety
seconds. There is no live migration. You are responsible for RAID configuration
and for noticing a failing disk.

**Use dedicated for** databases, CI runners, batch processing, anything
CPU-bound — workloads where you can tolerate a rebuild window and want the
hardware.

**Combine both:** cloud servers for the application tier where you want to scale
and replace freely, dedicated for the heavy, stable pieces. They share a private
network.

---

## Networking

**Private networks** connect servers with internal addresses at no cost and
without touching public bandwidth. Put your database on the private network
only, with no public IP at all — the cleanest form of database isolation
available.

**Firewalls** are network-level rules applied by label, sitting in front of the
server before any host firewall. They are free, and rules follow labels, so new
servers inherit protection automatically.

**Use both the Hetzner firewall and `ufw` on the host.** They are independent
layers, and a packet must pass both. When something is unreachable, check each
separately — this doubled layer is a routine source of confusion.

**Floating IPs** are static addresses that can be reassigned between servers in
seconds, which is what you use for a manual failover or blue-green cutover.

**Load Balancers** start around €5/month with health checks and TLS termination.
Cheaper than most competitors, and worth adding as soon as you have two servers.

---

## Storage

**Volumes** are network block storage, attachable and resizable, priced per GB
per month. Anything that grows — uploads, database files, backups — belongs on a
Volume rather than the server's root disk.

**Object Storage** is Hetzner's S3-compatible service, priced per terabyte with
included traffic. Considerably cheaper than S3 for storage-heavy workloads.

**Storage Box** is separate: FTP/SFTP/rsync/BorgBackup-accessible storage at very
low cost per terabyte. It is the natural backup destination, and it works
directly with `restic` and `borg`:

```bash
restic -r "sftp:u123456@u123456.your-storagebox.de:/backups" backup /srv/myapp
```

**Back up off the server.** Volumes and root disks share the failure domain of
the machine. A Storage Box in a different location does not.

---

## What You Run Yourself

Because there are no managed data services, the pieces you would rent elsewhere
become your responsibility:

- **PostgreSQL** — install, tune, and take your own `pg_dump` backups on a
  schedule you test. See [PostgreSQL](/knowledge-base/databases/postgresql).
- **Redis** — bind to the private network, set `maxmemory` and an eviction
  policy. See [Redis](/knowledge-base/redis).
- **Backups** — `restic` or `borg` to a Storage Box, plus a restore test.
- **Monitoring** — an external uptime check at minimum; Prometheus and Grafana
  if you want depth. See
  [Monitoring](/knowledge-base/operations/monitoring).
- **TLS** — Certbot with automatic renewal. See
  [SSL/TLS](/knowledge-base/hosting/ssl-tls).

**Budget the time honestly.** The saving is real, and so is the hour or two a
month. A common and sensible compromise is Hetzner for compute with a managed
database elsewhere — the database is where operational mistakes are least
recoverable.

---

## Automation

The API is good and the Terraform provider is well maintained:

```hcl
resource "hcloud_server" "web" {
  name        = "web-01"
  image       = "ubuntu-24.04"
  server_type = "cax21"
  location    = "fsn1"
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  network {
    network_id = hcloud_network.private.id
  }

  firewall_ids = [hcloud_firewall.web.id]
}
```

`hcloud`, the CLI, covers the same surface. **Define servers in code** — the
whole point of cheap instances is being able to recreate them freely, and that
only works if the configuration is written down.

**Cloud-init** is supported at creation, so the entire first-hour hardening from
the [VPS page](/knowledge-base/hosting/vps#initial-setup) can run automatically.

---

## Cost Comparison

Approximate monthly cost for 4 vCPU and 8 GB of RAM:

| Provider                  | Approximate |
| ------------------------- | ----------- |
| **Hetzner (CPX31/CAX31)** | ~€13        |
| **DigitalOcean**          | ~$48        |
| **AWS EC2 (on-demand)**   | ~$60+       |
| **Google Cloud**          | ~$55+       |

Bandwidth widens the gap further: 20 TB included at Hetzner against per-GB
egress elsewhere, where 1 TB out of AWS alone costs around $90.

**When the saving is not the deciding factor:** if you need a managed database
with point-in-time recovery, a global CDN with edge compute, specific compliance
certifications, or regions Hetzner does not have — pay for them. The comparison
is only meaningful when the products are genuinely comparable, and here they are
not.

---

## Do's and Don'ts

### Do

- Apply the full [VPS hardening](/knowledge-base/hosting/vps) to every server.
- Use private networks for internal traffic, and give databases no public IP.
- Use the Hetzner firewall _and_ a host firewall.
- Consider Arm (CAX) instances after checking your dependencies.
- Keep growing data on Volumes, not the root disk.
- Back up to a Storage Box with `restic` or `borg`, and test the restore.
- Define infrastructure in Terraform and bootstrap with cloud-init.
- Know where rescue mode is before you need it.
- Set up external uptime monitoring.

### Don't

- Don't expect managed databases — plan to run and back up your own.
- Don't leave a database on a public IP.
- Don't assume x86 images run on Arm instances.
- Don't keep backups only on the machine they came from.
- Don't rely on a single dedicated server for something that cannot tolerate a
  hardware replacement window.
- Don't grow the root disk when a Volume would do.
- Don't skip the monitoring you would have got free elsewhere.

---

## Common Mistakes

**Assuming a managed database exists.** It does not. Teams discover this after
migrating, and end up running PostgreSQL with no backup strategy.

**Locked out by the doubled firewall.** Cloud firewall and `ufw` both apply, and
both must allow SSH. Rescue mode is the way back.

**Arm surprises.** A dependency without an Arm64 build, or a Docker image built
only for `linux/amd64`. Check before you commit.

**No backups.** Nothing is backing anything up unless you configured it. This is
the single largest risk of the move.

**A dedicated server as a single point of failure.** Hardware fails and
replacement takes hours. Fine for CI, poor for a primary database with no
standby.

**Ignoring account verification.** New accounts may need identification, and
discovering this during an urgent migration is unpleasant.

**Treating it as a drop-in AWS replacement.** The compute maps over cleanly; the
managed services do not exist.

---

## Debugging

| Symptom                     | Where to look                                                  |
| --------------------------- | -------------------------------------------------------------- |
| Server unreachable          | Cloud firewall _and_ `ufw`; then rescue mode                   |
| Cannot boot after a change  | Rescue mode, mount the disk, fix `fstab` or grub               |
| Private network not working | Is the interface configured in the OS? Some images need it     |
| Docker image will not run   | Architecture mismatch on an Arm instance                       |
| Disk full                   | Volumes for data; check journal and Docker image sizes         |
| Bandwidth overage           | Internal traffic going over public IPs                         |
| Slow disk                   | Volumes are network storage — root disk is faster for hot data |

**Rescue mode is the tool that distinguishes Hetzner from a managed platform.**
It boots a live Linux with your disk attached, which recovers almost anything
short of hardware failure. Practise it once on a throwaway server.

---

## FAQ

**Is it actually reliable?**
Yes. Hetzner has operated for decades and its uptime is comparable to the large
clouds. The difference is in managed services and support depth, not in whether
the machines stay up.

**Data residency?**
German and Finnish data centres are within the EU, which satisfies most GDPR
requirements directly. Singapore and US regions are available for other
audiences.

**Can I run Kubernetes?**
Yes, self-managed, and the community `hcloud` cloud-controller and CSI drivers
work well. There is no managed control plane, so you own the upgrades.

**Hetzner or DigitalOcean?**
Hetzner if cost dominates and you are comfortable running your own data
services. [DigitalOcean](/knowledge-base/hosting/digitalocean) for managed
databases, App Platform, more regions and better documentation.

**Support quality?**
Competent and functional rather than hand-holding. Expect ticket-based support
with reasonable response times and no dedicated engineer.

**Is Arm worth it?**
If your stack supports it, yes — the best price-to-performance on the platform.
Test your build first; do not migrate production to find out.

---

## Check your understanding

<Quiz
question="A team migrates from AWS to Hetzner to cut costs. Which requirement most likely makes the migration a mistake?"
options={[
{
text: 'They depend on a managed database with point-in-time recovery and automatic failover',
correct: true,
why: 'Hetzner has no managed database offering. That capability becomes work the team must build, operate and test — precisely where operational mistakes are least recoverable.',
},
{text: 'They serve several terabytes of traffic per month', why: 'That is where Hetzner is strongest — 20 TB is included, against per-GB egress charges at AWS.'},
{text: 'They want to run their application on Linux VMs', why: 'That maps over cleanly and is the straightforward part of such a migration.'},
{text: 'They use Terraform to manage infrastructure', why: 'The Hetzner Terraform provider is well maintained.'},
]}
explanation={<>The compute translates cleanly; the managed services do not exist. A common compromise is Hetzner for compute with a managed database elsewhere, keeping the large saving without owning the riskiest operational responsibility.</>}
reference={{label: 'What you run yourself', href: '/knowledge-base/hosting/hetzner#what-you-run-yourself'}}
/>

<Quiz
question="After tightening firewall rules, a Hetzner server becomes unreachable over SSH. What is the recovery path?"
options={[
{
text: 'Boot into rescue mode from the console, mount the disk, and correct the firewall configuration',
correct: true,
why: 'Rescue mode boots a recovery Linux over the network with your disk attached, which recovers almost anything short of hardware failure.',
},
{text: 'Open a support ticket and wait for a network reset', why: 'Unnecessary — rescue mode is self-service and immediate.'},
{text: 'Rebuild the server from a snapshot and lose recent changes', why: 'A valid last resort that discards work rescue mode would have preserved.'},
{text: 'Reassign a floating IP to reach it on a different address', why: 'The firewall blocks by port and source, not by which address the traffic arrived on.'},
]}
explanation={<>Remember that the cloud firewall and host <code>ufw</code> are independent layers and a packet must pass both — the most common cause of exactly this lockout. Practise rescue mode once on a throwaway server, before you need it.</>}
reference={{label: 'Debugging', href: '/knowledge-base/hosting/hetzner#debugging'}}
/>

<Quiz
question="Which are sound practices on Hetzner?"
type="multiple"
options={[
{text: 'Putting the database on a private network with no public IP', correct: true, why: 'The cleanest isolation available — the database is simply not addressable from the internet.'},
{text: 'Backing up to a Storage Box with restic or borg, and testing the restore', correct: true, why: 'Off-machine backups survive the failure of the machine, and an untested backup is only a hypothesis.'},
{text: 'Keeping growing data on Volumes rather than the root disk', correct: true, why: 'Volumes resize freely and detach from the server; root disks do not shrink.'},
{text: 'Defining servers in Terraform with cloud-init bootstrap', correct: true, why: 'Cheap instances are only genuinely disposable if you can recreate them from written-down configuration.'},
{text: 'Relying on Hetzner backups as the complete data protection strategy', why: 'Automatic snapshots recover a broken server, not a record deleted last month, and they share the machine\'s failure domain.'},
]}
explanation={<>The pattern throughout: the price advantage is real, and it is paid for in operational responsibility you must actually discharge rather than assume.</>}
reference={{label: "Do's and Don'ts", href: '/knowledge-base/hosting/hetzner#dos-and-donts'}}
/>

<Quiz
question="A team moves to CAX (Arm64) instances for the price advantage. The application fails to start, reporting an executable format error. What happened?"
options={[
{
text: 'Something in the stack is x86-only — a native module or a Docker image built solely for linux/amd64',
correct: true,
why: 'Arm64 instances run Arm binaries. Most modern software has Arm builds, but a single x86-only dependency or single-architecture image stops the whole thing.',
},
{text: 'Arm instances cannot run Docker', why: 'They run Docker fine; the images must be built for the architecture.'},
{text: 'The Ubuntu image was corrupted during provisioning', why: 'The error points at binary architecture, not a damaged image.'},
{text: 'Arm instances require a different kernel version', why: 'The provided images ship a suitable kernel.'},
]}
explanation={<>Build multi-architecture images with <code>docker buildx</code>, and verify dependencies on an Arm instance before migrating production. Arm is the best price-to-performance on the platform when your stack supports it — test first rather than finding out during a cutover.</>}
reference={{label: 'Cloud servers', href: '/knowledge-base/hosting/hetzner#cloud-servers'}}
/>

<Quiz
question="What is the main risk of running a primary production database on a Hetzner dedicated server?"
options={[
{
text: 'Physical hardware can fail, and recovery means a support ticket and hardware replacement rather than a new instance in seconds',
correct: true,
why: 'There is no live migration on bare metal. The performance and price are excellent; the failure mode is a rebuild window measured in hours.',
},
{text: 'Dedicated servers cannot join a private network', why: 'They can, and sharing a private network with cloud servers is a common pattern.'},
{text: 'Dedicated servers have limited bandwidth', why: 'Bandwidth allowances are generous, often unmetered.'},
{text: 'Dedicated servers cannot use Volumes or Storage Boxes', why: 'Storage Boxes work over the network from anywhere; storage is not the constraint.'},
]}
explanation={<>Use dedicated hardware for workloads that tolerate a rebuild window — CI runners, batch processing, replicas — and keep a standby plus tested off-machine backups for anything whose loss you cannot absorb.</>}
reference={{label: 'Dedicated servers', href: '/knowledge-base/hosting/hetzner#dedicated-servers'}}
/>

---

## References

- [Hetzner Docs](https://docs.hetzner.com/) — cloud, dedicated, storage and DNS.
- [Hetzner Cloud API](https://docs.hetzner.cloud/) — the full API surface.
- [Terraform provider](https://registry.terraform.io/providers/hetznercloud/hcloud/latest/docs)
  — servers, networks, firewalls and load balancers.
- [Hetzner Community tutorials](https://community.hetzner.com/tutorials) —
  practical setup guides.
- [Storage Box documentation](https://docs.hetzner.com/robot/storage-box/) —
  backup destinations and access protocols.
- [VPS](/knowledge-base/hosting/vps) — the operational half of running Hetzner
  well.
