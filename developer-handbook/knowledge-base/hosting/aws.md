---
title: 'AWS'
description: 'The core Amazon Web Services a web developer actually uses — IAM, EC2, S3, RDS, CloudFront, Lambda — and the cost traps.'
---

# AWS

## Introduction

AWS offers over 200 services. A web application typically needs six: compute,
object storage, a managed database, DNS, a CDN, and IAM to control access to all
of them.

**Two things account for most AWS pain, and neither is technical complexity:**

1. **IAM.** Nearly every publicised AWS breach traces to over-permissive
   policies or leaked long-lived access keys. Get this right first.
2. **Cost.** The pricing model is granular and the defaults are not frugal.
   Bills grow quietly, and data transfer is the usual culprit.

**Should you use AWS?** If you need a specific service, a compliance posture, or
an organisation already invested in it — yes. If you need to run a web
application and a database, [a VPS](/knowledge-base/hosting/vps) is simpler and
cheaper, and you can move later. AWS rewards teams that need its breadth and
punishes those who adopt it by default.

---

## IAM

The service that controls access to everything else. Learn it before anything
else.

**The model:**

| Concept    | What it is                                           |
| ---------- | ---------------------------------------------------- |
| **User**   | A long-lived identity, usually a human               |
| **Role**   | A set of permissions something _assumes_ temporarily |
| **Policy** | A JSON document granting or denying specific actions |
| **Group**  | A collection of users sharing policies               |

**Roles, not users, for anything automated.** An EC2 instance, a Lambda function
or a GitHub Actions workflow should assume a role and receive short-lived
credentials. A long-lived access key in an environment variable is the thing
that ends up in a public repository.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::my-app-uploads/*"
    }
  ]
}
```

Note what this policy does **not** grant: no `s3:DeleteObject`, no access to
other buckets, no `s3:ListAllMyBuckets`. That is what least privilege looks like
in practice.

**The rules:**

- **Never use the root account** beyond initial setup and billing. Enable MFA on
  it and put the credentials away.
- **No wildcards in production policies.** `"Action": "*"` on `"Resource": "*"`
  is an administrator, whatever you named the role.
- **Prefer OIDC federation to access keys.** GitHub Actions can assume an AWS
  role directly with no stored secret at all — see
  [GitHub Actions](/knowledge-base/hosting/github-actions).
- **Rotate anything long-lived**, and audit with IAM Access Analyzer, which
  reports permissions granted but never used.
- **MFA on every human account**, without exception.

See [Authorization](/knowledge-base/security/authorization) for the underlying
principles.

---

## Compute

| Service           | What it is                     | Suits                                      |
| ----------------- | ------------------------------ | ------------------------------------------ |
| **EC2**           | Virtual machines               | Full control; the same work as a VPS       |
| **ECS / Fargate** | Managed containers             | Container workloads without managing hosts |
| **Lambda**        | Functions, per-request billing | Spiky, event-driven, short tasks           |
| **App Runner**    | Container to URL               | The simplest path for a web service        |
| **Lightsail**     | Fixed-price VPS                | Predictable, simple, AWS-adjacent          |

**EC2** gives you a server and every responsibility on the
[VPS page](/knowledge-base/hosting/vps). Security groups are the firewall:
default-deny inbound, and **never open port 22 or a database port to
`0.0.0.0/0`**. Use Session Manager for shell access and you need no inbound SSH
at all.

**Lambda** is excellent for bursty or event-driven work and awkward for
long-running processes. Watch for:

- **Cold starts** — significant for JVM and .NET, small for Node and Python.
- **Timeouts** — 15 minutes maximum.
- **Database connections** — each concurrent invocation opens its own. Use RDS
  Proxy, or you will exhaust the connection limit under load. This is the
  classic serverless-plus-relational failure.

**Fargate** is the middle ground: containers, no servers to patch, predictable
performance, more expensive per unit than EC2.

---

## S3

Object storage, and the service almost every application touches.

**Storage classes:**

| Class                                         | For                                           |
| --------------------------------------------- | --------------------------------------------- |
| **Standard**                                  | Frequently accessed                           |
| **Intelligent-Tiering**                       | Unknown patterns; moves objects automatically |
| **Standard-IA**                               | Infrequent access, immediate retrieval        |
| **Glacier Instant / Flexible / Deep Archive** | Archives, decreasing cost and speed           |

**Lifecycle rules move objects between classes automatically.** Old logs and
backups on Standard are pure waste — a rule that transitions them after 30 days
often halves a storage bill.

**Security.** Public access is blocked by default at the account level. Keep it
that way.

- **Serve public assets through CloudFront**, with the bucket private and an
  Origin Access Control granting only CloudFront read access. Cheaper than S3
  egress, and the bucket never needs to be public.
- **Use presigned URLs** for user uploads and private downloads, so the browser
  talks to S3 directly with a time-limited, scope-limited URL.
- **Enable versioning** on anything that matters — it makes deletion
  recoverable.
- **Encryption is on by default** (SSE-S3). Use KMS when you need key control or
  an audit trail.

```js
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({region: 'eu-west-2'});

const url = await getSignedUrl(
  s3,
  new PutObjectCommand({
    Bucket: 'my-app-uploads',
    Key: `uploads/${userId}/${crypto.randomUUID()}`,
    ContentType: 'image/jpeg',
  }),
  {expiresIn: 300},
);
```

**Never let the client choose the key path unchecked** — that is how one user
overwrites another's files. Derive it from the authenticated user, as above. See
[File Uploads](/knowledge-base/web/file-uploads).

---

## RDS

Managed PostgreSQL, MySQL, MariaDB and others. AWS handles backups, patching,
replicas and failover.

**Configuration that matters:**

- **Multi-AZ** for production — a standby in another availability zone with
  automatic failover. It roughly doubles the cost and removes a whole class of
  incident.
- **Automated backups** with a retention period you have actually thought about
  (default 7 days, maximum 35).
- **Never publicly accessible.** Put it in a private subnet, reachable only from
  your application's security group.
- **Encryption at rest**, enabled at creation — it cannot be turned on later
  without a snapshot restore.
- **Performance Insights**, which is free at basic retention and shows you which
  queries are actually expensive.

**Aurora** is AWS's own engine, PostgreSQL- and MySQL-compatible, with faster
replication and storage that scales automatically. **Aurora Serverless v2**
scales capacity with load and suits variable workloads. Both cost more than
plain RDS.

**RDS Proxy** pools connections in front of the database. Essential with Lambda,
useful with any autoscaling compute.

See [PostgreSQL](/knowledge-base/databases/postgresql) for the database itself.

---

## CloudFront and Route 53

**CloudFront** is AWS's CDN. Everything on the
[CDN page](/knowledge-base/hosting/cdn) applies. AWS-specific points:

- **Origin Access Control** keeps the S3 bucket private.
- **Certificates for CloudFront must be issued in `us-east-1`**, regardless of
  where anything else lives. This surprises everyone once.
- **Cache policies** replaced the older per-distribution settings — use managed
  policies where they fit.
- **CloudFront egress is cheaper than S3 egress**, so serving through it saves
  money as well as latency.

**Route 53** is DNS, with health checks and latency- or geolocation-based
routing. Aliases point at AWS resources without an extra lookup and cost
nothing. See [DNS](/knowledge-base/hosting/dns).

---

## Cost Control

**Set this up on day one, before you deploy anything.**

- **A billing alarm.** Budgets → set a monthly threshold → email alert. The
  cheapest insurance in AWS.
- **Cost Explorer, grouped by service**, checked weekly at first. Surprises are
  much cheaper when found early.
- **Tag everything** with project and environment, so the bill can be attributed.

**Where the money actually goes:**

| Cause                         | Notes                                                 |
| ----------------------------- | ----------------------------------------------------- |
| **Data transfer out**         | The most common surprise. Cross-AZ traffic costs too. |
| **NAT Gateway**               | ~$32/month plus per-GB, and easy to forget            |
| **Idle load balancers**       | ~$16/month each, doing nothing                        |
| **Unattached EBS volumes**    | Deleted instances often leave disks behind            |
| **Old snapshots**             | Accumulate indefinitely without a lifecycle rule      |
| **Over-provisioned RDS**      | Frequently the largest single line item               |
| **CloudWatch Logs retention** | Defaults to _never expire_ — set it                   |

**Savings Plans and Reserved Instances** cut compute cost 30–70% for committed
usage. Only commit once your baseline is stable — a one-year commitment on a
workload you rebuild in three months is a loss.

**Spot instances** are up to 90% cheaper and can be reclaimed at two minutes'
notice. Excellent for batch and CI, unsuitable for a database.

---

## Infrastructure as Code

**Do not configure production by clicking through the console.** Nobody can
review it, reproduce it, or tell what changed.

| Tool                           | Notes                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| **Terraform / OpenTofu**       | Multi-cloud, huge ecosystem, the common default            |
| **AWS CDK**                    | Real code (TypeScript, Python) compiling to CloudFormation |
| **CloudFormation**             | Native, verbose, no extra tooling                          |
| **SST / Serverless Framework** | Application-focused, opinionated                           |

Use the console to explore and to read state; use code to create anything you
intend to keep.

---

## Do's and Don'ts

### Do

- Enable MFA on root, then stop using it.
- Use roles and short-lived credentials; use OIDC from CI.
- Grant least privilege and audit with Access Analyzer.
- Set a billing alarm before deploying.
- Put databases in private subnets, reachable only from the app's security
  group.
- Serve S3 content through CloudFront with Origin Access Control.
- Set a CloudWatch Logs retention period explicitly.
- Enable Multi-AZ and encryption on production RDS.
- Define infrastructure as code.
- Tag resources for cost attribution.

### Don't

- Don't use root for day-to-day work.
- Don't create long-lived access keys where a role would do.
- Don't write `"Action": "*"` in a policy you intend to keep.
- Don't open port 22 or a database port to `0.0.0.0/0`.
- Don't make S3 buckets public to serve assets.
- Don't connect Lambda directly to RDS without a proxy.
- Don't leave NAT Gateways, load balancers or EBS volumes running unused.
- Don't commit to a Savings Plan before your baseline is stable.

---

## Common Mistakes

**Access keys in a repository.** Automated scanners find them within minutes and
mine cryptocurrency on your account. Use roles; enable secret scanning; if it
happens, revoke first and investigate second.

**A wildcard policy "for now".** It stays. Start restrictive and add permissions
as they fail.

**A public S3 bucket for assets.** Private bucket plus CloudFront is cheaper,
faster and safer.

**A publicly accessible RDS instance.** Private subnet, security group scoped to
the application.

**Lambda exhausting database connections.** Each concurrent invocation opens its
own. RDS Proxy, or a serverless-friendly database.

**A NAT Gateway nobody remembers creating.** Around $400 a year, silently.

**CloudWatch Logs never expiring.** Years of debug logs at storage rates.

**Requesting a CloudFront certificate outside `us-east-1`.** It simply will not
attach, with an unhelpful error.

**Console-only configuration.** Unreviewable, unreproducible, and the person who
built it has left.

---

## Debugging

| Symptom                         | Where to look                                                   |
| ------------------------------- | --------------------------------------------------------------- |
| `AccessDenied`                  | IAM policy simulator; check both identity and resource policies |
| Lambda times out                | VPC config — no NAT means no internet access                    |
| Cannot reach RDS                | Security group inbound rule, subnet routing                     |
| CloudFront serves stale content | Cache behaviour and TTL; create an invalidation                 |
| Certificate won't attach        | Is it in `us-east-1`, and validated?                            |
| S3 403 through CloudFront       | Origin Access Control and bucket policy                         |
| Unexpected bill                 | Cost Explorer grouped by service, then by usage type            |
| Instance unreachable            | Security group, then Session Manager instead of SSH             |

**CloudTrail records every API call** — it is the definitive answer to "who
changed this and when". Enable it on day one; you cannot retrofit history.

---

## FAQ

**Is AWS more expensive than a VPS?**
For a simple application, considerably — often 3–5×. You are paying for
breadth, availability guarantees and managed services. Whether that is worth it
depends entirely on whether you use them.

**Where should I start?**
App Runner or Lightsail for a straightforward web application; EC2 if you want
control; Lambda for event-driven work. Add services only when you have a
specific need.

**Which region?**
The one closest to your users, or where data residency requires. `us-east-1` is
the largest, gets features first, and has the most publicised outages.

**Do I need a VPC?**
You already have one — a default VPC exists in every region. Design your own
when you need private subnets, which is as soon as you run a database.

**Free tier?**
Twelve months of limited usage on many services, plus some always-free tiers.
Set a billing alarm anyway; the transition off the free tier is a common
surprise.

**How do I avoid lock-in?**
Prefer portable services (EC2, S3-compatible storage, standard PostgreSQL) over
proprietary ones (DynamoDB, Step Functions) where the choice is genuinely equal.
Where the proprietary service is significantly better, take it deliberately.

---

## Check your understanding

<Quiz
question="A team stores an IAM access key in a CI environment variable to deploy from GitHub Actions. What is the better approach?"
options={[
{
text: 'Configure OIDC federation so the workflow assumes an IAM role and receives short-lived credentials, with no stored secret at all',
correct: true,
why: 'A long-lived key is a permanent credential that can leak through logs, forks or a compromised runner. OIDC issues credentials per run, scoped and expiring.',
},
{text: 'Store the key in an encrypted secret and rotate it monthly', why: 'Better than plaintext, and still a long-lived credential that exists to be leaked.'},
{text: 'Create a separate IAM user per repository', why: 'It limits blast radius but keeps the underlying problem of permanent credentials.'},
{text: 'Use the root account access key so all deploys work', why: 'The worst option available — root should have no access keys at all.'},
]}
explanation={<>The general rule: roles and short-lived credentials for anything automated, long-lived keys only where nothing else is possible. Leaked keys are found by automated scanners within minutes of being pushed.</>}
reference={{label: 'IAM', href: '/knowledge-base/hosting/aws#iam'}}
/>

<Quiz
question="A Lambda function queries an RDS PostgreSQL database. Under load it fails with 'too many connections' even though the function itself is fast. Why?"
options={[
{
text: 'Each concurrent Lambda invocation opens its own connection, so concurrency directly multiplies connections against a fixed database limit',
correct: true,
why: 'Lambda has no shared process to pool connections across invocations. A few hundred concurrent executions exhausts a typical RDS connection limit.',
},
{text: 'Lambda functions leak connections because they cannot run cleanup code', why: 'They can close connections; the problem is how many exist simultaneously, not that they leak.'},
{text: 'RDS rate-limits connections from Lambda specifically', why: 'There is no Lambda-specific limit — it is the ordinary max_connections setting.'},
{text: 'The function needs a longer timeout', why: 'The failure is at connection time; more time does not create capacity.'},
]}
explanation={<>Put <strong>RDS Proxy</strong> between them: it maintains a pool and multiplexes many invocations onto few database connections. This is the classic serverless-plus-relational failure, and it appears only under concurrency — so load testing catches it and functional testing does not.</>}
reference={{label: 'Compute', href: '/knowledge-base/hosting/aws#compute'}}
/>

<Quiz
question="What is the recommended way to serve public images stored in S3?"
options={[
{
text: 'Keep the bucket private and put CloudFront in front of it with an Origin Access Control',
correct: true,
why: 'The bucket never becomes public, CloudFront egress is cheaper than S3 egress, and users get edge caching. Better on all three counts.',
},
{text: 'Make the bucket public and link directly to the object URLs', why: 'Public buckets are a recurring source of accidental data exposure, and S3 egress is more expensive with no caching.'},
{text: 'Generate a presigned URL for every image on every page load', why: 'Presigned URLs are for private or time-limited access; generating them for public assets adds work and defeats caching.'},
{text: 'Proxy every image request through your application server', why: 'It works and wastes compute and bandwidth on something a CDN does better.'},
]}
explanation={<>Reserve presigned URLs for uploads and private downloads — and when generating one for an upload, derive the object key from the authenticated user rather than accepting it from the client, or one user can overwrite another's files.</>}
reference={{label: 'S3', href: '/knowledge-base/hosting/aws#s3'}}
/>

<Quiz
question="Which of these cause unexpected AWS bills?"
type="multiple"
options={[
{text: 'Data transfer out, including cross-availability-zone traffic', correct: true, why: 'The most common surprise. Egress is metered per gigabyte and cross-AZ traffic is charged in both directions.'},
{text: 'A NAT Gateway left running', correct: true, why: 'Roughly $32/month plus per-GB charges, easily forgotten because nothing visibly depends on it.'},
{text: 'CloudWatch Logs with no retention period set', correct: true, why: 'The default is never expire, so years of debug logs accumulate at storage rates.'},
{text: 'Unattached EBS volumes and old snapshots', correct: true, why: 'Terminated instances leave disks behind, and snapshots accumulate indefinitely without a lifecycle rule.'},
{text: 'Enabling CloudTrail', why: 'The management-event trail is free and is the definitive record of who changed what. Enable it on day one — history cannot be retrofitted.'},
]}
explanation={<>Set a billing alarm before deploying anything, tag resources so the bill can be attributed, and review Cost Explorer grouped by service weekly at first. Surprises are far cheaper when found early.</>}
reference={{label: 'Cost control', href: '/knowledge-base/hosting/aws#cost-control'}}
/>

<Quiz
question="A team requests an ACM certificate in eu-west-2 for their CloudFront distribution, but it cannot be selected. What is wrong?"
options={[
{
text: 'Certificates used with CloudFront must be issued in us-east-1, regardless of where the rest of the infrastructure lives',
correct: true,
why: 'CloudFront is a global service whose certificate configuration is read from us-east-1 only. The certificate is valid — it is simply in the wrong region for this use.',
},
{text: 'The certificate has not finished DNS validation', why: 'A real cause of unusable certificates, and it would show as pending rather than as an unavailable option in another region.'},
{text: 'ACM certificates cannot be used with CloudFront at all', why: 'They are the normal choice, and they are free.'},
{text: 'The distribution must be recreated to change its certificate', why: 'Certificates can be changed on an existing distribution.'},
]}
explanation={<>Reissue in <code>us-east-1</code> — ACM certificates are free, so there is no cost to the duplicate. This catches nearly everyone once, and the error message does not explain it.</>}
reference={{label: 'CloudFront and Route 53', href: '/knowledge-base/hosting/aws#cloudfront-and-route-53'}}
/>

---

## References

- [AWS Documentation](https://docs.aws.amazon.com/) — the service-by-service
  reference.
- [IAM security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
  — read this before granting anything.
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
  — the five pillars, and a useful review checklist.
- [S3 security best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
  — public access, encryption and access control.
- [AWS Pricing Calculator](https://calculator.aws/) — estimate before you build.
- [Configuring OIDC in AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
  — keyless deploys from GitHub Actions.
