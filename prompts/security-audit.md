---
description: Perform a comprehensive security audit of the codebase and write findings to docs/security-audit/
---

You are performing a security audit of this codebase. Be rigorous about confidence:
a suspicious pattern is not a finding until you have traced it to an
attacker-controlled input or verified the impact. False positives waste reviewer
time and erode trust in the report.

## Output

Write all output to `docs/security-audit/` in the repo. Create the directory if it
does not exist. Do not print findings to chat beyond a short summary; the markdown
files are the deliverable.

Structure:

- `docs/security-audit/README.md` — index, scope, tooling, and remediation order.
- `docs/security-audit/<ID>-<kebab-slug>.md` — one file per finding.
- `docs/security-audit/INFO-clean-checks.md` — single catch-all for areas
  audited-and-clean plus minor observations not severe enough to be findings.

### Handling an existing audit

If `docs/security-audit/` already contains finding files, this is a re-audit.
Do not delete or renumber existing files. Treat them as the prior baseline.

For every existing finding file:

1. Read the file to understand the original issue and affected locations.
2. Re-check the affected code, config, or dependency. Look at the actual files
   referenced, not just the description.
3. Update the **Status** field at the top of the file based on what you find
   (see status values below).
4. Append a `## Re-audit YYYY-MM-DD` section to the file recording what you
   checked, what changed since the prior audit (commit SHA range if you can
   determine it, or "see diff in `path/to/file`"), and the evidence for the
   new status. Keep prior `## Re-audit` sections intact, newest at the bottom.
5. Do NOT rewrite the original Description, PoC, or Fix sections. They are
   historical record.

For new issues discovered in this run, allocate the next free ID in the
appropriate severity (e.g. if `H1`–`H4` exist, the next High is `H5`). IDs
never get reused.

If a previously-reported finding has been re-classified (e.g. you now believe
it was a false positive, or the severity was wrong), keep the original ID but
update Severity/Status and explain the reclassification in the new
`## Re-audit` section.

### ID scheme

Severity-prefixed, numbered within severity, in discovery order. IDs are
**stable across re-audits** and never reused.

- `C1`, `C2`, ... Critical
- `H1`, `H2`, ... High
- `M1`, `M2`, ... Medium
- `L1`, `L2`, ... Low
- `INFO` (single file)

Slug is a short kebab-case summary, e.g. `C1-subscription-override.md`,
`H2-insecure-secret-key-default.md`, `M3-jwt-payload-in-logs.md`.

### Status values

- **Open** — issue confirmed present. Default for new findings.
- **Fixed** — verified remediated. Record what was changed and where.
- **Partially fixed** — some affected locations resolved, others still present.
  List which.
- **Regression** — was previously Fixed, now present again. Treat with urgency
  in the remediation order.
- **Won't fix** — owner has decided not to remediate. Requires a brief reason
  in the Re-audit section (compensating control, deprecated component, etc.).
- **Accepted risk** — risk acknowledged and consciously accepted, typically
  with a sign-off reference.
- **False positive** — on re-examination, this was never a real issue. Explain
  what was misread the first time.

### README.md format

```markdown
# Security Audit — <repo or app name>

Audit date: YYYY-MM-DD
Prior audit date: YYYY-MM-DD (omit if first audit)
Scope: <languages, frameworks, infra files actually reviewed>
Tooling: <tools run, with one-word status, e.g. "pip-audit (clean), gitleaks (clean), targeted greps">

## Findings index

| ID                           | Severity | Status | Title                               |
| ---------------------------- | -------- | ------ | ----------------------------------- |
| [C1](C1-<slug>.md)           | Critical | Open   | <one-line title>                    |
| [C2](C2-<slug>.md)           | Critical | Fixed  | <one-line title>                    |
| ...                          | ...      | ...    | ...                                 |
| [INFO](INFO-clean-checks.md) | Info     | —      | Clean checks and minor observations |

## Status changes this re-audit

(Omit this section on first audit. Otherwise list deltas vs prior audit.)

- **Fixed:** C2, H1, M4
- **Regression:** H3 (was Fixed in prior audit, now Open)
- **New:** M7, L6
- **Reclassified:** L2 → Won't fix (compensating control documented)

## Suggested remediation order

1. **Today:** all `Open` Critical, any `Regression` regardless of severity, and
   any `Open` High that is trivially exploitable.
2. **This sprint:** remaining `Open` High, exploitable `Open` Medium.
3. **Backlog:** remaining `Open` Medium, all `Open` Low.

Skip Fixed, Won't fix, Accepted risk, and False positive entries.

## Coverage statement

- **Audited:** <list of areas covered>.
- **Not audited:** <list of areas skipped, with reason: out of scope, requires
  runtime access, time-boxed, etc.>
```

### Finding file format

````markdown
# <ID> — <Short title>

- **Severity:** Critical | High | Medium | Low
- **Status:** Open | Fixed | Partially fixed | Regression | Won't fix | Accepted risk | False positive
- **Confidence:** Confirmed | Likely | Suspected
- **Category:** OWASP A0X:2025 <name>
- **CWE:** CWE-XXX (<name>)
- **First reported:** YYYY-MM-DD
- **Last verified:** YYYY-MM-DD

## Affected

- `path/to/file.ext:line-range`
  ```<lang>
  # optional code snippet, keep tight
  ```
- `path/to/other-file.ext:line`

## Description

<What the issue is, how it gets reached, why it matters in _this_ codebase
specifically. Reference concrete config defaults, env vars, and call paths
rather than generic theory.>

## Proof of concept

<Required for Critical. Recommended for High when safe. Omit otherwise.
Show a single curl/script/input that demonstrates the impact. Do NOT run
exploits against live systems.>

## Fix

<Concrete, ordered steps. Include a code or config patch where useful.
If there are tradeoffs, name them.>

## Re-audit YYYY-MM-DD

(Add a new section per re-audit run. Keep prior sections intact.)

- **Status change:** Open → Fixed (or "no change", etc.)
- **Verified by:** <what you checked. e.g. "src/apps/.../subscription.py:55-63
  now requires `request.auth.is_staff`; ECS prod task def has
  `ENABLE_SUBSCRIPTION_OVERRIDE=False`">
- **Notes:** <anything relevant, e.g. fixed in commit abc1234, partial fix
  in one of three affected files, or reasoning for Won't fix>
````

Confidence rules:

- **Confirmed:** data flow traced from attacker-controlled input to sink, or the
  misconfiguration is plainly visible in committed code.
- **Likely:** strong indirect evidence, but one assumption remains untested
  (e.g. you could not confirm the prod env var is unset).
- **Suspected:** pattern match only. Use this rather than inflating severity.

Severity is impact-based. Confidence is evidence-based. A `Critical / Suspected`
finding is allowed and useful.

## Procedure

### Step 0a: Check for existing audit

Before recon, check whether `docs/security-audit/` already exists. If it does:

- Read `README.md` to understand the prior scope, date, and finding inventory.
- Note the next free ID per severity. New findings in this run continue from
  there.
- Plan to re-verify every existing finding (see "Handling an existing audit"
  above). Re-verification happens alongside the new audit, not as a separate
  pass: when you reach the relevant area in Steps 2–7, check both for new
  issues and for the status of prior findings in that area.

If `docs/security-audit/` does not exist, proceed normally; this is a first
audit.

### Step 0: Recon and scoping

Before any checks, establish context:

- Languages, frameworks, and major libraries in use.
- Entry points: HTTP routes, CLI commands, message consumers, scheduled jobs,
  webhooks, file ingestion paths.
- Trust boundaries: where untrusted input enters, where privilege levels cross.
- Data sensitivity: PII, payment data, health data, auth tokens, secrets for
  other systems.
- Deployment model: container, serverless, VM, static. Public exposure?
- Existing security controls (WAF, auth middleware, framework defaults) so you
  do not re-flag controls that exist.

If the codebase is large, state in the README which areas you prioritized and why.

### Step 1: Threat model sketch

List the top 5 to 10 threats specific to this application based on Step 0. This
guides which findings actually matter. A theoretical IDOR in admin-only code
matters less than a real one on a public endpoint.

### Step 2: Dependency and supply chain (A03:2025)

This step gathers evidence for A03 Software Supply Chain Failures.

- Run the appropriate auditor: `npm audit`, `pip-audit`, `cargo audit`,
  `govulncheck ./...`, `bundle audit`, `composer audit`.
- For each Critical/High advisory, trace whether the vulnerable function is
  actually called. Mark unreachable advisories in INFO rather than as findings.
- Check lockfile integrity: pinned versions, integrity hashes present.
- Check for typosquatting risk in direct dependencies.
- Check for SBOM generation in the build pipeline (CycloneDX, SPDX). Absence
  is worth flagging in a modern codebase.
- Check artifact provenance: are build outputs signed (Sigstore/cosign)? Are
  Docker base images pinned by digest, not tag?
- In CI: are third-party actions/images pinned by SHA, not floating tags?
  Is `pull_request_target` used safely?

### Step 3: Secrets

Prefer purpose-built tools over regex:

- Run `gitleaks detect` or `trufflehog filesystem .` against the working tree.
- Run `gitleaks detect --log-opts="--all"` against full git history. A secret
  removed from HEAD is still leaked and must be rotated.
- Check `.env`, `.env.*`, config files, fixtures, test files, comments, and
  committed log files.
- Verify `.gitignore` excludes sensitive files AND that nothing matching those
  patterns is currently tracked.
- Look for cloud key shapes: `AKIA`, `ASIA`, `AIza`, `ghp_`, `gho_`, `xoxb-`,
  `sk_live_`, JWT-shaped strings, private key headers.
- For any secret found, recommendation is always: rotate first, remove second.

### Step 4: OWASP Top 10 (2025)

Cover each category, citing the OWASP code in findings (e.g. `OWASP A01:2025`):

- **A01 Broken Access Control:** missing authz checks, IDOR, force browsing,
  client-side-only restrictions, JWT trust without verification, CORS misconfig.
  **Now includes SSRF** (previously A10:2021): any code that fetches a URL
  derived from user input without allowlisting, blocking metadata endpoints
  (169.254.169.254, link-local), and blocking private IP ranges.
- **A02 Security Misconfiguration:** default credentials, debug/stack traces to
  users, permissive CORS, missing security headers (CSP, HSTS,
  X-Content-Type-Options), exposed admin interfaces, storage public by default,
  cloud/container/IaC misconfig (overly broad IAM, public S3, open security
  groups). Moved up from #5 in 2021; this is now the #2 risk.
- **A03 Software Supply Chain Failures:** broader than the old "Vulnerable and
  Outdated Components". Covers vulnerable dependencies (Step 2), build system
  integrity, CI/CD pipeline trust, dependency provenance (signed artifacts,
  SBOMs), typosquatting, malicious or compromised packages, and unverified
  third-party actions/images. Trust failures in the build and distribution
  process, not just CVEs.
- **A04 Cryptographic Failures:** weak algorithms (MD5, SHA1 for passwords,
  DES, ECB mode), hardcoded keys/IVs, `Math.random()` for security purposes,
  unencrypted transit, improper certificate validation.
- **A05 Injection:** SQLi, command injection, LDAP/XPath/NoSQL injection,
  template injection, XSS (server-rendered vs DOM-based treated separately).
- **A06 Insecure Design:** missing rate limiting, no account lockout, business
  logic flaws, lack of defense in depth, threat modeling gaps.
- **A07 Authentication Failures:** weak password policy, credential stuffing
  exposure, session fixation, predictable session IDs, no MFA option, password
  recovery flaws.
- **A08 Software or Data Integrity Failures:** unsigned updates, insecure
  deserialization (pickle, Java native, unsafe YAML, PHP unserialize), CI/CD
  pipelines that pull unverified artifacts, auto-update mechanisms without
  signature verification.
- **A09 Logging & Alerting Failures:** no audit log for auth events, logs
  containing secrets/PII, no alerting on suspicious patterns, no detection
  of brute force or credential stuffing.
- **A10 Mishandling of Exceptional Conditions:** failing open on errors (e.g.
  auth check throws and request proceeds), swallowed exceptions that hide
  security-relevant failures, error handlers that leak stack traces or
  internal state, logical errors in abnormal states, retry logic that bypasses
  controls, race conditions and TOCTOU.

### Step 5: Input validation and output encoding

- Server-side validation on every user input (client-side alone is not
  validation).
- Type, length, range, and format checks.
- File uploads: content-type validation, magic-byte verification, size limits,
  filename sanitization, storage outside webroot.
- Open redirect: any redirect with user-controlled destination has an allowlist.
- Output encoding context-appropriate (HTML, JS, URL, CSS, SQL).

### Step 6: AuthN and AuthZ deep dive

- Password storage: bcrypt, scrypt, argon2, or PBKDF2 with adequate cost. Flag
  MD5, SHA1, SHA256-without-salt, or rolled-your-own.
- Session: secure cookie flags (HttpOnly, Secure, SameSite), rotation on
  privilege change, server-side invalidation on logout.
- JWT: signature verification (not just decode), algorithm pinning (reject
  `none`, reject HS256 when expecting RS256), short expiration, refresh token
  rotation, audience and issuer validation, no sensitive data in claims.
- CSRF protection on state-changing requests that use cookie auth.
- Authorization enforced at the API/service layer, not only the UI.
- Multi-tenancy: tenant ID never trusted from the client.

### Step 7: Infrastructure and CI/CD

- Dockerfile: non-root USER, no secrets in layers, pinned base image, minimal
  base, no unnecessary packages.
- Compose/Kubernetes: no `privileged: true` without justification, no host
  network/PID/IPC, resource limits set, read-only root FS where possible,
  secrets via secret manager not env in YAML.
- IaC (Terraform, CloudFormation, CDK): no public S3/blob, encryption at rest
  enabled, security groups not 0.0.0.0/0 on sensitive ports, IAM policies not
  `*:*`.
- CI: secrets scoped to specific workflows, third-party actions pinned by SHA,
  no `pull_request_target` running untrusted code with secrets, OIDC preferred
  over long-lived cloud keys.

### Step 8: Write the report

For a **first audit**:

- Create one markdown file per finding using the finding format above.
- Create the README index.
- Create `INFO-clean-checks.md` listing areas audited-and-clean plus
  defense-in-depth suggestions that do not warrant individual findings.

For a **re-audit**:

- Update the **Status** and **Last verified** fields at the top of each
  existing finding file.
- Append a `## Re-audit YYYY-MM-DD` section to every existing finding file,
  including ones with no status change (record "no change" explicitly, so it's
  clear the finding was actually re-checked).
- Create new finding files for any new issues, using the next free ID per
  severity.
- Update the README index: refresh the Status column, regenerate the
  "Status changes this re-audit" section, refresh the remediation order
  (regressions and new Criticals jump to top), and bump the audit date.
- Update `INFO-clean-checks.md` if any previously-clean area now has issues
  (move it out and create a finding) or vice versa.

After writing files, print a short chat summary:

- First audit: total finding counts by severity, top 3 to fix today, and a
  one-line path to the index.
- Re-audit: counts of Fixed / Regression / New / Open this run, plus the top 3
  to address (regressions first, then new Criticals/Highs), plus path to the
  index.

## Rules

- Trace before reporting. For Critical/High Confirmed, follow the data flow
  from user input to sink. If you cannot, downgrade confidence.
- Confidence matters. Mark suspected findings as suspected. Do not inflate a
  pattern match into a Critical.
- Do not execute exploits against live systems. Do not exfiltrate any secret
  or data discovered. Do not modify code outside of `docs/security-audit/`.
- Do not invent CVE numbers, line numbers, or file paths. Open the file and
  verify the line range before writing it. If unsure, omit.
- Do not just list tools. Run them, read the output, analyze it.
- Cover application code AND infrastructure config (Dockerfiles, compose,
  CI configs, IaC).
- If you ran out of context or time, say so in the Coverage Statement rather
  than producing a falsely complete report.
- On re-audit: never delete, renumber, or rewrite the historical content of
  an existing finding file. Status, Last verified, and a new `## Re-audit`
  section are the only edits. IDs are permanent.
- On re-audit: do not mark anything `Fixed` without verifying. "It looks like
  it was fixed" is not enough; check the actual file and config. If you
  cannot verify, leave it `Open` and note the verification gap.
