# Personal Finance Dashboard

A self-hosted, single-user personal finance dashboard — React 19 + TypeScript (Vite), FastAPI
(Python 3.12), PostgreSQL 16, and Nginx, deployed with Docker Compose.
Design details live in [`docs/superpowers/specs/2026-08-12-finance-dashboard-design.md`](docs/superpowers/specs/2026-08-12-finance-dashboard-design.md).

```
Browser ── HTTPS ──[optional: Cloudflare proxy, Part 6]── Nginx container (SPA static + /api proxy, 80/443)
                                                              │
                                                              ▼
                                                      FastAPI container (uvicorn :8000, internal only)
                                                              │ asyncpg (Docker bridge → host)
                                                              ▼
                                                  PostgreSQL 16 on the instance host
                                                              │ nightly cron: pg_dump
                                                              ▼
                                                  OCI Object Storage bucket (backups)
```

This README is the full deployment runbook: OCI Always Free instance bring-up → server
setup → deploy → verify → backups → updates → production data, verification & cutover
(**Part 7**) → troubleshooting. The default setup is accessed directly at the instance's
public IP over HTTPS with a self-signed certificate — no domain needed. Putting a real
domain in front later is **Part 6**, and switching takes minutes (the configs are shared
between both modes).

> **Why not plain HTTP?** Without TLS, your login password and all financial data cross
> the internet in cleartext on every visit. The self-signed cert costs one extra command
> and a one-time browser warning, and everything is encrypted.

---

## Part 0 — Before you start (on your local machine)

You need:

- An **OCI account** with Always Free resources available (see capacity check below).
- **GitHub access** to this private repo.
- An **SSH keypair** (`ssh-keygen -t ed25519` in PowerShell if you don't have one;
  the public key is `~/.ssh/id_ed25519.pub`).
- No domain required — that's optional Part 6.

Then prepare:

1. **Push `main` to GitHub.** The server deploys whatever is on GitHub, so the deploy
   files (`nginx.conf`, `docker-compose.prod.yml`, `.env.example`,
   `backend/scripts/backup_db.sh`, this README) must be pushed first.
2. **Create a server-only GitHub token**: GitHub → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token. Scope it to
   **only this repository** with **Contents: Read-only**, set an expiry, and save it —
   it is used once in Part 3 to clone. Never reuse a broad-scope token on the server.

## Part 1 — Provision the OCI instance

### 1.1 Check remaining Always Free capacity

Always Free Ampere A1 is capped at **4 OCPUs / 24 GB RAM total across the tenancy**, and
block storage at **200 GB total** — shared with any instance you already run.

- OCI Console → ☰ menu → **Compute → Instances**: note the shape of each existing instance
  (e.g. `VM.Standard.A1.Flex (2 OCPU, 12 GB)`). Remaining A1 budget = 4 − used OCPUs,
  24 − used GB.
- ☰ → **Storage → Block Storage → Boot Volumes**: sum the sizes. The new instance adds
  ~47 GB (the minimum); the total must stay ≤ 200 GB.

This app is light — **1–2 OCPUs and 6–12 GB** is generous. If the full 4/24 is already in
use, resize the existing instance down first (Instance → More actions → Edit → shape).

### 1.2 Create the instance

☰ → **Compute → Instances** → **Create instance** (section names shift slightly between
console versions, but every field below is in the wizard):

| Field | Value |
|---|---|
| Name | `finance-dashboard` |
| Compartment | root (or wherever your other instance lives) |
| Placement | any availability domain (Always Free A1 exists only in your **home region**) |
| Image | **Canonical Ubuntu 24.04** (Change image → Ubuntu) |
| Shape | Change shape → **Ampere** → `VM.Standard.A1.Flex` → set OCPUs/RAM per your budget (e.g. 2 OCPU / 12 GB) |
| Networking | reuse the existing VCN + public subnet if you have one (its security list likely already opens 80/443), or let the wizard create a new VCN |
| Public IP | **Assign a public IPv4 address** ✓ |
| SSH keys | paste your `~/.ssh/id_ed25519.pub` |
| Boot volume | default (~47 GB) |

Click **Create**. When it reaches *Running*, copy the **Public IP address** from the
instance details page — it's how you'll reach the dashboard, so keep it handy.

> **"Out of capacity" error**: Ampere A1 free capacity fluctuates. Retry with fewer
> OCPUs, a different availability domain, or just try again later (early mornings work
> best). Don't fall back to the AMD `VM.Standard.E2.1.Micro` — 1 GB RAM is too small to
> build the images.

> **IP stability**: the default ephemeral public IP survives reboots and is only lost if
> the instance is terminated. If you ever recreate the instance, either update the IP
> everywhere it appears (`CORS_ORIGINS`, the cert SAN in 2.5, your bookmarks) or assign a
> **Reserved Public IP** (Networking → Reserved IPs) so it never changes.

### 1.3 Open ports 80/443

☰ → **Networking → Virtual cloud networks** → your VCN → **Subnets** → your subnet →
its **Security List** → **Add Ingress Rules**:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Port 22 is already open by default. (Optional hardening: edit the 22 rule's source to
your home IP — and since only you use the dashboard, you can scope 80/443 the same way.)
If you reused the other instance's subnet, these rules may already exist.

## Part 2 — Server setup

SSH in: `ssh ubuntu@<public-ip>`

### 2.1 Base packages

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 2.2 Docker

```bash
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker
```

### 2.3 PostgreSQL 16 (on the host)

```bash
sudo apt-get install -y postgresql postgresql-contrib
```

Create the user and database (pick a strong password — you'll put the same value in
`.env` as `POSTGRES_PASSWORD`; generate one with `openssl rand -base64 24`):

```bash
sudo -u postgres psql <<SQL
CREATE USER finance WITH PASSWORD '<your-db-password>';
CREATE DATABASE finance OWNER finance;
SQL
```

Containers reach the host through the Docker bridge, so Postgres must listen on the
bridge gateway and allow container subnets.

Edit `/etc/postgresql/16/main/postgresql.conf`:

```
listen_addresses = 'localhost,172.17.0.1'
```

Edit `/etc/postgresql/16/main/pg_hba.conf` — add before any restrictive rules
(`172.16.0.0/12` covers every Docker bridge subnet):

```
# Docker bridge networks
host    finance    finance    172.16.0.0/12    scram-sha-256
```

Restart:

```bash
sudo systemctl restart postgresql
```

### 2.4 Firewall: lock down port 5432

The OCI security list already blocks 5432 from the internet; this is defense-in-depth on
the host. OCI Ubuntu images ship an iptables INPUT chain that ends in a catch-all REJECT,
so the rules must be **inserted at the top** (`-I`), not appended:

```bash
sudo iptables -I INPUT 1 -p tcp --dport 5432 -s 127.0.0.1 -j ACCEPT
sudo iptables -I INPUT 2 -p tcp --dport 5432 -s 172.16.0.0/12 -j ACCEPT
sudo iptables -I INPUT 3 -p tcp --dport 5432 -j DROP

# Persist across reboots (answer Yes to saving current rules)
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

(Ports 80/443 need no iptables changes: Docker publishes them through the FORWARD chain,
which it manages itself.)

### 2.5 TLS certificate (self-signed)

Nginx serves HTTPS from `/etc/ssl/finance/`. For IP-only access, generate a self-signed
certificate with the instance's public IP in the SAN (10-year validity):

```bash
sudo mkdir -p /etc/ssl/finance
sudo openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout /etc/ssl/finance/key.pem \
  -out /etc/ssl/finance/cert.pem \
  -subj "/CN=finance-dashboard" \
  -addext "subjectAltName=IP:<public-ip>"
sudo chmod 644 /etc/ssl/finance/cert.pem
sudo chmod 600 /etc/ssl/finance/key.pem
```

Browsers will show a warning the first time because no public authority vouches for the
cert — the connection is still fully encrypted. Accept it once per browser, or silence it
permanently by importing `cert.pem` into your OS trust store (see 3.4).

If you later put a domain in front, the same two file paths just get different contents —
see Part 6.

## Part 3 — Deploy

### 3.1 Clone

Use the fine-grained read-only token from Part 0:

```bash
git clone https://<github-username>:<server-token>@github.com/edw-li/personal-finance-dashboard.git ~/personal-finance-dashboard
cd ~/personal-finance-dashboard
```

### 3.2 Configure `.env`

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Fill in every value:

| Variable | Value |
|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | `finance` / `finance` (as created in 2.3) |
| `POSTGRES_PASSWORD` | the password from 2.3 |
| `ENVIRONMENT` | `prod` |
| `SECRET_KEY` | `openssl rand -hex 32` (prod refuses to boot with < 32 bytes) |
| `CORS_ORIGINS` | exactly `https://<public-ip>` — the origin you access the app at (comma-separated if you ever add a domain; `*` is rejected) |
| `ADMIN_EMAIL` | your login email — **keep this stable**: the seed renames the admin account to match it on every boot, so changing it later changes your login |
| `ADMIN_PASSWORD` | your login password, 8–72 bytes (bcrypt limit) |
| `OCI_*` | backup settings — fill in during Part 5 (values may be blank until then; they're only read by the backup script) |

### 3.3 Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build takes a few minutes (the images build natively on aarch64 — CI only builds
amd64, so this build is the real gate). Compose waits for the backend healthcheck —
which requires migrations and the admin seed to have succeeded — before starting nginx.
If it fails, nothing is silently broken: the command errors and
`docker compose -f docker-compose.prod.yml logs backend` shows why.

### 3.4 Verify

```bash
# Both services up, backend "(healthy)"
docker compose -f docker-compose.prod.yml ps

# Migrations applied, admin seeded, "Application startup complete"
docker compose -f docker-compose.prod.yml logs backend

# API through nginx over TLS (-k: self-signed cert isn't in curl's trust store)
curl -sk https://localhost/api/v1/health     # → {"status":"ok"}

# HTTP redirects to HTTPS
curl -sI http://localhost/ | head -1         # → HTTP/1.1 301 Moved Permanently
```

Then from your own machine: open **`https://<public-ip>`**. Expect the browser's
self-signed-certificate warning → *Advanced* → *Proceed* (a one-time acknowledgment per
browser). Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

To remove the warning for good (optional): copy the cert down —
`scp ubuntu@<public-ip>:/etc/ssl/finance/cert.pem .` — and import it into your OS trust
store (Windows: double-click → Install Certificate → Local Machine → *Trusted Root
Certification Authorities*).

## Part 4 — Updating the app

### 4.1 The update flow

```bash
cd ~/personal-finance-dashboard
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Only changed layers rebuild. Migrations run automatically on backend start, and the
healthcheck gates nginx, so a bad migration fails the deploy loudly. Nginx re-resolves
the backend container's IP within ~10 s of a backend-only redeploy (the `resolver` +
variable `proxy_pass` in `nginx.conf`) — if API calls ever 502 after a redeploy anyway,
`docker compose -f docker-compose.prod.yml restart frontend` clears it.

### 4.2 Scheduler & settings

All three settings in **/settings** take effect without a restart. `price_refresh_cron`
is **hot-applied**: saving a new value stores it and reschedules the live scheduler job in
the same request (`backend/app/api/app_settings.py`); boot re-reads the stored value
anyway, so a later restart loses nothing. The other two, `swr_pct` and `espp_ticker`, are
read per request and take effect on the next page load.

### 4.3 Migration history: never re-chain a deployed revision

A deployed database records where it is by **revision id** — one row in `alembic_version`.
Reordering the chain after the fact (inserting a new parent beneath a revision that has
already run, renumbering, "tidying" the sequence) leaves prod's recorded id pointing into a
history that no longer exists: the revisions in between are silently skipped, and the first
query touching a column they were supposed to add 500s. The same trap spans a merge — if two
branches claim the same revision id, deploying one before merging the other strands the
other's migrations.

**New migrations chain onto the current head; a revision that has shipped is immutable.**

If it happens anyway, `alembic stamp <revision>` forces `alembic_version` back to the truth —
recovery of last resort. Stamping *asserts* a schema state rather than producing one, so
verify the real schema by hand on both sides of it; restoring a backup (5.5) is often safer.

### 4.4 After a deploy: stale tabs and the shell-cache check

Frontend assets are content-hashed, so a deploy changes the filenames of every asset it rebuilt. A tab left open
across a deploy still holds the old shell, and the first time it needs a route chunk it has
not already loaded, that request 404s — the app catches it and renders **"This page failed to load.
Reloading usually fixes it."** with a **Reload** button. That is designed behavior, not an outage; reloading clears
it.

Reload only helps if the browser re-fetches `index.html` rather than replaying a cached copy,
which is what the `location = /index.html` block in `nginx.conf` guarantees. Verify it on the
server after a deploy that changed the frontend:

```bash
curl -skI https://localhost/net-worth | grep -i cache-control   # → Cache-Control: no-cache
```

The header has to survive the SPA fallback: `/net-worth` is not a file, so `try_files` issues
an internal redirect to `/index.html`, and `no-cache` lands only because that redirect
re-enters the exact-match block. If this ever returns nothing or a caching value, Reload will
keep re-serving the stale shell and the tab stays broken — fix nginx before deploying again.

## Part 5 — Nightly backups to OCI Object Storage

### 5.1 Create the bucket

☰ → **Storage → Buckets** → **Create Bucket** → name `finance-db-backups`, keep defaults
(private visibility). On the bucket details page, note the **Namespace** value.

### 5.2 Create S3-compatible credentials

Console top-right profile icon → **My profile** → under Resources: **Customer secret
keys** → **Generate secret key**. Copy the **Access Key** and the **Secret Key** (shown
only once).

### 5.3 Configure and test

On the server, fill the `OCI_*` block in `.env`: the two keys, `OCI_BUCKET_NAME`,
`OCI_NAMESPACE` (from 5.1), and `OCI_REGION` — the region identifier **the bucket was
created in** (the console's region picker at the top showed it in 5.1, e.g.
`us-sanjose-1`). The endpoint is regional and the request signature embeds this value,
so it must match the bucket's region exactly.

Optionally add `BACKUP_PASSPHRASE` to the same `.env` to encrypt every dump before upload
(`gpg --symmetric --cipher-algo AES256`; objects land as `.sql.gz.gpg`). Generate one with
`openssl rand -base64 32` and keep a copy somewhere **off this server** — without the
passphrase an encrypted backup is unrecoverable. The encrypted path needs `gnupg` on the
server (`sudo apt-get install -y gnupg` — Ubuntu 24.04 ships it, but verify with
`gpg --version`). Leaving it unset keeps plaintext dumps and prints a one-line warning per
run. The encrypted path is exercised here, on the server, the first time you run the
script after setting it — the dev box has no OCI credentials, so this check happens at
deploy time by design.

```bash
sudo apt-get install -y python3-boto3
chmod +x backend/scripts/backup_db.sh
./backend/scripts/backup_db.sh
```

Expected output ends with `Backup complete.`; the object
`backups/finance_<date>.sql.gz` (`.sql.gz.gpg` when `BACKUP_PASSPHRASE` is set) appears
in the bucket. The script keeps 30 days of backups — each run deletes both flavors of the
dump from 30 days prior — and records the run for the Settings System card (the
`Last backup` marker plus a last-10 trail).

### 5.4 Schedule

```bash
crontab -e
```

```
0 3 * * * /home/ubuntu/personal-finance-dashboard/backend/scripts/backup_db.sh >> /home/ubuntu/finance-backup.log 2>&1
```

### 5.5 Restore drill (do this once now, and after any schema change you care about)

```bash
# Download a backup: bucket → object → Download (or scp it to the server)
# Plaintext backups:
gunzip finance_<date>.sql.gz
# Encrypted backups (.sql.gz.gpg) — gpg prompts for BACKUP_PASSPHRASE, or pipe straight
# into the restore: gpg --decrypt finance_<date>.sql.gz.gpg | gunzip | psql ...
gpg --decrypt finance_<date>.sql.gz.gpg | gunzip > finance_<date>.sql

# Restore into a scratch database and spot-check
sudo -u postgres createdb -O finance finance_restore
psql -h localhost -U finance -d finance_restore -f finance_<date>.sql
psql -h localhost -U finance -d finance_restore -c "SELECT count(*) FROM users;"

# Real disaster recovery: swap the restored DB in
docker compose -f docker-compose.prod.yml stop backend
sudo -u postgres psql -c "ALTER DATABASE finance RENAME TO finance_broken;"
sudo -u postgres psql -c "ALTER DATABASE finance_restore RENAME TO finance;"
docker compose -f docker-compose.prod.yml start backend

# Clean up the scratch DB if it was only a drill
sudo -u postgres dropdb finance_restore
```

## Part 6 — Optional: put a domain in front (Cloudflare)

Worth doing if you get tired of typing an IP, want a browser-trusted padlock, or want
Cloudflare's proxy shielding the origin. Prerequisite: a domain whose DNS is managed by
Cloudflare. On [dash.cloudflare.com](https://dash.cloudflare.com), select the zone:

1. **DNS record**: DNS → Records → Add record → Type `A`, Name `finance` (→
   `finance.your-domain.com`), IPv4 address = the instance's public IP,
   **Proxy status: Proxied** (orange cloud).
2. **Origin certificate** (replaces the self-signed pair; Cloudflare-signed, valid up to
   15 years, trusted *through* the Cloudflare proxy): SSL/TLS → **Origin Server** →
   Create Certificate → keep the default hostnames → Create. On the server, paste the
   **Origin Certificate** over `/etc/ssl/finance/cert.pem` and the **Private Key** over
   `/etc/ssl/finance/key.pem` (the key is shown only once; keep the same file
   permissions), then reload nginx:
   ```bash
   docker compose -f docker-compose.prod.yml restart frontend
   ```
3. **TLS mode**: SSL/TLS → Overview → **Full (strict)**. (Zone-wide setting — fine if
   your other proxied hosts also have origin certs.)
4. **Backend origin check**: in `.env`, set
   `CORS_ORIGINS=https://finance.your-domain.com` (comma-add the old
   `https://<public-ip>` origin if you want both to keep working), then
   `docker compose -f docker-compose.prod.yml up -d` to recreate the backend.
5. Optional: enable **HSTS** (SSL/TLS → Edge Certificates) — careful: it applies
   zone-wide to every proxied site on the domain.

Direct `https://<public-ip>` visits will show cert warnings after this (the origin cert
only names the domain) — expected; use the domain.

## Part 7 — Production data: import, verification & cutover

Parts 0–6 get an **empty** app running. This part fills it from the spreadsheet, checks the
numbers against their source, and hands over from the sheet to the app.

### 7.1 When you need this

- **Fresh production database** — disaster recovery, or re-provisioning onto a new instance:
  run 7.2 → 7.5 in order.
- **A deliberate re-import**, because the sheet changed underneath the app: 7.2, then
  re-check 7.5.
- **The database that is live today** (imported 2026-08-13, Plans 1–5 deployed) needs none of
  that. Routine deploys are **7.6**; retiring the sheet is **7.7**.

### 7.2 Import the workbook

Two paths, one importer — the app calls the same code the CLI does.

**From the app**: **/settings** → *Import workbook* → choose `<path-to-workbook>.xlsx` →
**Dry run** (parses the file and shows the diff it *would* apply; writes nothing) → review it
→ **Apply import**. Apply is armed only by a clean dry run of the *current* selection: picking
a file again, or an apply that fails, clears the report and disarms it. The upload must be
≤ 15 MB (the app's cap; nginx's is 20 MB).

**From the box**, with the workbook copied onto the server:

```bash
docker compose -f docker-compose.prod.yml exec backend python -m app.importer /path/on/box.xlsx --dry-run
docker compose -f docker-compose.prod.yml exec backend python -m app.importer /path/on/box.xlsx
```

The CLI's default is **inverted** from the upload's: the CLI **applies** unless you pass
`--dry-run`, while the app dry-runs unless you confirm. Exit codes — `0` clean (a clean
`--dry-run` included), `2` the file is missing or is not a readable `.xlsx`, `1` anything else.
Non-zero always means nothing was written; read the output.

> **ORDER LAW: import first, then edit in the UI.** Re-importing taxes is *sheet-wins* inside
> the years the sheet covers — any UI edit to a sheet-covered year is clobbered by the next
> Apply. (The import card repeats this warning before Apply.) Import once, then let the app be
> the system of record.

### 7.3 Verify the five component accounts (fresh database)

Five 401(k) source buckets roll up into two parent accounts (the Fidelity Traditional and
Roth 401(k)s) and carry `is_component` so that net worth counts each parent instead of both. The importer **seeds those five flags at account
creation** (`backend/app/importer/apply.py`, shipped 2026-08-15 and pinned by a test), so a
fresh import lands correctly flagged and this step is a **check, not a repair** — the two
migrations that backfill the flag (`f1b36c0cf33c`, then `c8a1f4d27b53`'s guarded re-run) both
no-op here, because migrations run at container boot, before the accounts they would flip
exist. Check it:

```bash
sudo -u postgres psql -d finance -tAc "SELECT slug FROM accounts WHERE is_component ORDER BY sort_order"
```

That must list exactly those five slugs and nothing else. If it doesn't, repair and re-check —
the flags are **yours after creation** (re-imports never touch them), so a wrong answer means
either a database imported by a pre-2026-08-15 importer or a flag edited by hand since. A
MISSING flag is repaired by the belt-and-braces, idempotent UPDATE below; an EXTRA flagged
slug goes the other way — `PATCH /net-worth/accounts/{id}` with `{"is_component": false}`
(the UPDATE can only add flags):

```bash
sudo -u postgres psql -d finance -c "UPDATE accounts SET is_component = TRUE WHERE slug IN ('employer-match-401-k','reverse-rollover-401-k','traditional-401-k','roth-basic-401-k','after-tax-401-k')"
```

(Adjust the `psql` invocation to however this host runs Postgres.)

> **Expected divergence**: with the five flagged, the dashboard's net worth equals the
> sheet's **minus the After-Tax 401(k) bucket** — deliberate. The sheet double-counts that
> one, confirmed at all 37 historical snapshots. If you ever prefer the sheet's number
> reproduced exactly, one `PATCH /net-worth/accounts/{id}` with `{"is_component": false}` on
> `after-tax-401-k` does it.

### 7.4 First price refresh + ZI hygiene

Trigger it from **/portfolio** → **Refresh prices**, or `POST /api/v1/prices/refresh`. Expect
roughly **36 tickers updated**. One failure is expected and permanent: **ZI** (ZoomInfo,
delisted) returns *"no data returned"* on every run until it is deactivated — set `is_active`
false in the securities panel and the refresh stops trying.

Until that first refresh lands, annual income, yield and yield-on-cost render the stale
GOOGLEFINANCE values carried in from the sheet. Expected, not a bug — they correct themselves
on the first successful refresh.

### 7.5 Verify before trusting

| Check | Where | Expected |
|---|---|---|
| Net worth identity | /net-worth totals vs the sheet's NET WORTH row | equal with the five component flags set (7.3), less the After-Tax component by design |
| Taxes | /taxes, year by year | 2024 matches the sheet **to the cent except the state chain and the CG/NIIT split** (both deliberate, below); 2023 / 2025 / 2026 differ by the known sheet drifts (below), plus the CA divergence and the NIIT line where the year carries gains/investment income |
| Holdings | cost basis, per row | within ~$0.10 of the sheet (6dp shares × 4dp prices folding) |
| Scheduler | /settings → price refresh cron | day **names** (`10 13 * * mon-fri`), never numbers |

**The five documented tax divergences** — the four sheet drifts, plus one deliberate model
fix. D1 −31.20; D2 +405.50 and +117.85; D3 +4,918.92/93 at cents — each a place the
sheet's own columns disagree with one another; the app is the self-consistent model. The
fifth is different in kind — **CA capital-gains taxation (2026-08-25)**: California taxes
capital gains and all dividends as ordinary income, and the sheet's state chain never
added them in ANY year, so here the app is right and the sheet was wrong. For a year
carrying LTCG / qualified dividends / other CG the app's state tax is **≥ the sheet's**:
+12.00 for 2023 and +16.66 for 2024 at the stored inputs; 2025's state figures now MATCH
the sheet, because D2's CG-in-AGI drift had pushed the gains into its state chain by
accident (its +117.85 state half now reads sheet-vs-its-own-formula, not sheet-vs-app);
2026 carries no gains and is unchanged. **Do not "fix" any of these** — a reconciliation
that makes them vanish has introduced a bug, not removed one.

**Three more deliberate divergences (2026-08-31, tax-engine completeness):**

- **NIIT as an explicit line.** The sheet folded the 3.8% surcharge into its CG bracket
  rates (18.8/23.8) and never tested the income side; the app stores base CG rates —
  migration `f7d3b2a91c40` rewrote the exact folded pair, the importer translates it on
  every re-import, and a warning flags any leftover — and computes
  NIIT = 3.8% × min(net investment income, MAGI − threshold) as its own line.
  One nuance inside NII: the per-component clamps mean a short-term loss never offsets
  a long-term gain inside NII (the statute nets them first) — deliberate and
  formula-faithful, covered by the same do-not-fix rule. At the
  stored inputs: 2024 +75.59 NIIT / −6.81 CG (net **+68.79** total tax vs the sheet,
  total 72,824.61); 2025 +418.88 / −48.15 (net **+370.73**, total 90,421.49); 2023 sits
  under the threshold and 2026 has no investment income — both unchanged.
- **Capital-loss deduction reaches AGI.** The sheet modelled `capital_loss_deductions`
  (r27) and read it in no output formula; the app subtracts it in federal AGI, the state
  chain and MAGI (CA conforms to the $3k rule). Stored years all carry 0, so no
  historical total moved — future loss years will differ from the sheet by design.
- **SALT phase-down on true MAGI.** The >500k phase-down of the raised cap now tests
  AGI + netted capital gains, so a CG-heavy year's itemized *suggestion* can shrink
  toward the $10k floor where the old code (plain AGI) would not.

**Do not "fix" any of these** — the same rule as the five above.

**On the cron**: a legacy numeric day-of-week (`10 13 * * 1-5`) is misread by the scheduler
(APScheduler counts `0` as Monday, so the whole range slips a day) *and* makes the settings
form's first Save fail with a 422 until it is rewritten with names. A shipped repair
migration fixes the one mis-seed we know of automatically; this check catches any other
numeric variant.

### 7.6 Routine deploy

Plans 5 and 6 add **zero migrations** — the Alembic head stays `e5b93d0a416f` — so this
deploy is order-safe (4.3 does not apply) and needs none of 7.2–7.5:

```bash
cd ~/personal-finance-dashboard
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Then verify: `curl -sk https://localhost/api/v1/health` → `{"status":"ok"}`, log in, and
spot-check **/** (Overview), **/taxes** and **/settings**.

> **Addendum (2026-08-17)**: the *zero migrations* line above held through Plan 6 only.
> The portfolio-performance-chart merge adds **one additive migration** —
> `portfolio_value_history`, chained onto that head (4.3 respected) — so the head becomes
> `705ec03f614f`. It runs at backend boot like every other, so the command above is still
> the whole deploy, and it is order-safe both directions: old code never touches the table,
> and the downgrade just drops it. The spot-checks shift too — **/** (Overview) now
> carries the portfolio performance chart where the allocation-by-type donut did (the
> donut stays on **/portfolio**), and both it and **/portfolio**'s new Performance panel
> read *"No performance history yet"* until the next import (7.2) seeds the table:
> expected on a first deploy, not a regression.

> **Addendum (2026-08-20)**: rich dividend tracking adds one more additive migration —
> `b3d47a1c9e62`, chained on `705ec03f614f` and applied at boot like every other — and the
> first refresh after it backfills roughly a year of `source='auto'` dividend rows by
> itself, so **/portfolio** → **Dividends** fills in without any extra step.

> **Addendum (2026-08-21)**: the RSU vesting + withholding build adds one more additive
> migration — `983a8ec3f1cd` (`rsu_grants`), chained on `b3d47a1c9e62` and applied at boot
> like every other. The table is **dashboard-only**: workbook imports never read or write
> it (pinned by test), so re-imports are unaffected; the downgrade is a bare `drop_table`
> with no foreign keys in or out and no old-code references, order-safe both directions.
> The spot-checks grow again — **/comp** carries the RSU grants card and the computed
> vesting schedule below the trajectory (both empty until grants are entered, and a focal
> year with refresh RSUs offers a seed chip that fills the form in one click), and
> **/taxes** carries the *"Will I owe?"* withholding tracker on the **current** calendar
> year alone: absent on a settled year by design, not a regression. The `espp_ticker`
> setting doubles as the employer/RSU ticker — without it the schedule renders unpriced
> and says so.

> **Addendum (2026-08-28)**: historical ex-dividend markers add one more additive
> migration — `e4a7c92b6d18` (`security_dividend_events` + a `securities` marker column),
> chained on `d3b8e05fa726` and applied at boot like every other. The 08-20 "backfills
> roughly a year" note above stays the LEDGER's whole story; this table is display-only
> annotation data (ex-dates + per-share, never dollar amounts) that the first refresh
> after deploy deep-fetches once per security so the **/portfolio** performance chart's
> pre-window era shows its ex-dividend markers. A blocked provider marks nothing and
> retries on every refresh until it answers; zero-payer tickers are marked done and never
> refetched. Workbook imports never touch the table (pinned by test).

> **Addendum (2026-08-31)**: the tier-1 tax-completeness batch adds one **guarded data
> migration** — `f7d3b2a91c40`, chained on `e4a7c92b6d18` — rewriting exact folded
> capital-gains rates (`0.1880 → 0.1500`, `0.2380 → 0.2000`, all years and statuses) now
> that NIIT is computed as its own line. It runs at boot like every other; the downgrade
> restores the folded pair under the same exact-match guard (documented asymmetry: a
> genuinely-base-rate year re-folds on downgrade, which the old engine's advisory then
> names). After deploy, /taxes totals for investment-income years shift by the NIIT
> entries in §7.5 — expected, not a regression.

That restart re-reads `price_refresh_cron` (4.2). If it happens to span **13:10 PT**, the
day's scheduled price refresh is skipped — the **Refresh prices** button recovers it. Run the
4.4 cache-control check once after the first deploy carrying the split route chunks.

### 7.7 Parallel-run & retiring the sheet

Run both systems for **at least one full monthly cycle** before trusting the app alone: do
the month-end ritual in the **/update** wizard *and* in the sheet, then compare the net-worth
summary, spending totals, holdings market value, and — if a tax year changed — the /taxes
summary. Judge every difference against 7.5: the After-Tax offset and the five documented tax
divergences are expected, anything else is not. One clean cycle and the sheet stops being updated — keep it
as a frozen archive, which the importer remains able to re-consume if 7.2 is ever needed
again.

Before calling it done, close out the security items:

- **Revoke the deploy token.** The 3.1 clone embeds the read-only PAT in the remote URL.
  Revoke it on GitHub and re-point the remote at the plain URL (the next `git pull` will ask
  for credentials — issue a fresh short-lived token then):
  ```bash
  git remote set-url origin https://github.com/edw-li/personal-finance-dashboard.git
  ```
- **Optionally rotate the prod secrets** in `.env` — `SECRET_KEY`, `POSTGRES_PASSWORD`, the
  `OCI_*` pair. Rotating `SECRET_KEY` invalidates existing logins; expected.
- **Confirm the backups are real**: the nightly cron ran within the last 24 h
  (`tail /home/ubuntu/finance-backup.log`, and the object is in the bucket), and do one
  restore drill end to end (5.5). Cutting over onto an unverified backup is the one failure
  this runbook cannot undo.

## Troubleshooting

**Backend unhealthy / compose up fails** — `docker compose -f docker-compose.prod.yml
logs backend`. Alembic or seed errors print there; the healthcheck exists precisely so
these fail the deploy instead of 502ing.

**`no pg_hba.conf entry for host "172.x.y.z"`** — the container's subnet isn't covered.
The `172.16.0.0/12` line in 2.3 covers all Docker bridges; check it was added and
`sudo systemctl restart postgresql`.

**Backend can't reach Postgres at all** — confirm the bridge gateway:
`docker network inspect personal-finance-dashboard_default | grep Gateway`, then check
`listen_addresses` includes `172.17.0.1` (that's what `host.docker.internal` maps to)
and restart Postgres.

**Postgres fails to start after a reboot** — rare race: Postgres binds `172.17.0.1`
before Docker creates the bridge. `sudo systemctl restart postgresql` fixes it; if it
recurs, set `listen_addresses = '*'` (safe here: pg_hba + the iptables DROP still deny
outside access).

**Site unreachable at `https://<public-ip>`** — security list missing 80/443 (1.3),
containers down (`docker compose ps`), or the frontend container crash-looping on an
nginx config/cert-path error (`docker compose logs frontend`).

**Browser cert warning** — expected in IP mode (self-signed; see 3.4 to silence). In
domain mode via the domain it is *not* expected — re-check Part 6 step 2.

**Login fails with a CORS error in the browser console** — `CORS_ORIGINS` must exactly
match the origin in the address bar (scheme included, no trailing slash). Edit `.env`,
then `docker compose -f docker-compose.prod.yml up -d` to recreate the backend.

**(Domain mode) Cloudflare 521/522** — Cloudflare can't reach the origin: security list,
containers down, or DNS record pointing at the wrong IP.

**(Domain mode) Cloudflare 526** — TLS mode is Full (strict) but the origin cert wasn't
installed correctly (Part 6 step 2).

**`start.sh: not found` or exec format errors in the backend container** — CRLF line
endings sneaked into a checkout. Verify on the server: `od -c backend/start.sh | head -2`
must show `\n`, never `\r \n`. (`.gitattributes` prevents this; a Linux clone is safe.)

**Ports 80/443 time out but the security list is right** — Docker's iptables chains were
clobbered (e.g. by restoring saved rules after Docker started): `sudo systemctl restart
docker`.

**Backup fails: `SignatureDoesNotMatch ... The secret key required to complete
authentication could not be found. The region must be specified if this is not the home
region for the tenancy.`** — the request's signature named the wrong region. The script
passes `OCI_REGION` as boto3's `region_name` precisely for this; if it still occurs:
(1) `OCI_REGION` doesn't match the region the *bucket* lives in — check the console's
region picker while viewing the bucket; (2) the customer secret key was generated
seconds ago — IAM replication to non-home regions can lag a few minutes; (3) the
access/secret pair is mismatched — regenerate under My profile → Customer secret keys
and re-copy both values.

## Security notes

- The repo is private; the server's GitHub token is fine-grained, read-only, expiring.
- `.env` holds every secret — `chmod 600`, never committed (`.gitignore` +
  `.dockerignore` both exclude it, so it can't leak into the git history *or* image
  build context).
- Postgres: bound to localhost + Docker bridge, scram auth, iptables DROP on 5432, OCI
  security list closed. Only 22/80/443 are reachable from outside.
- All traffic is TLS-encrypted. The self-signed cert doesn't prove the server's identity
  to a first-time browser (trust-on-first-use) — import it into your trust store, or use
  domain mode (Part 6), to close that gap.
- The whole app sits behind JWT auth; only `/login` and `/api/v1/health` are public.
- Backups live in a private bucket under scoped S3 credentials, optionally encrypted
  before upload with `gpg --symmetric` — set `BACKUP_PASSPHRASE` in `.env` (see 5.3);
  plaintext dumps print a warning per run.
