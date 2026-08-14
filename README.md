# Personal Finance Dashboard

A self-hosted, single-user personal finance dashboard — React 19 + TypeScript (Vite), FastAPI
(Python 3.12), PostgreSQL 16, and Nginx, deployed with Docker Compose behind Cloudflare.
Design details live in [`docs/superpowers/specs/2026-08-12-finance-dashboard-design.md`](docs/superpowers/specs/2026-08-12-finance-dashboard-design.md).

```
Browser ── Cloudflare (TLS, proxy) ── Nginx container (SPA static + /api proxy, 80/443)
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

This README is the full deployment runbook: OCI Always Free instance bring-up → DNS/TLS →
server setup → deploy → verify → backups → updates → troubleshooting.

---

## Part 0 — Before you start (on your local machine)

You need:

- An **OCI account** with Always Free resources available (see capacity check below).
- A **domain managed by Cloudflare** (the dashboard runs on a subdomain of it).
- **GitHub access** to this private repo.
- An **SSH keypair** (`ssh-keygen -t ed25519` in PowerShell if you don't have one;
  the public key is `~/.ssh/id_ed25519.pub`).

Then prepare the repo:

1. **Pick the subdomain** (e.g. `finance.your-domain.com`) and set it in `nginx.conf` —
   replace `finance.YOUR-DOMAIN.com` in **both** server blocks.
2. **Commit and push to `main`.** The server deploys whatever is on GitHub, so the deploy
   files (`nginx.conf`, `docker-compose.prod.yml`, `.env.example`,
   `backend/scripts/backup_db.sh`, this README) must be pushed first.
3. **Create a server-only GitHub token**: GitHub → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token. Scope it to
   **only this repository** with **Contents: Read-only**, set an expiry, and save it —
   it is used once in Part 4 to clone. Never reuse a broad-scope token on the server.

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
instance details page.

> **"Out of capacity" error**: Ampere A1 free capacity fluctuates. Retry with fewer
> OCPUs, a different availability domain, or just try again later (early mornings work
> best). Don't fall back to the AMD `VM.Standard.E2.1.Micro` — 1 GB RAM is too small to
> build the images.

### 1.3 Open ports 80/443

☰ → **Networking → Virtual cloud networks** → your VCN → **Subnets** → your subnet →
its **Security List** → **Add Ingress Rules**:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Port 22 is already open by default. (Optional hardening: edit the 22 rule's source to
your home IP.) If you reused the other instance's subnet, these rules may already exist.

## Part 2 — Cloudflare DNS + origin certificate

On [dash.cloudflare.com](https://dash.cloudflare.com), select your domain's zone:

1. **DNS record**: DNS → Records → Add record → Type `A`, Name `finance`,
   IPv4 address = the instance's public IP, **Proxy status: Proxied** (orange cloud).
2. **TLS mode**: SSL/TLS → Overview → **Full (strict)**. (If other proxied hosts on the
   zone don't have origin certs yet, leave the zone mode as-is — don't break them.)
3. **Origin certificate**: SSL/TLS → **Origin Server** → Create Certificate → keep the
   default hostnames (`*.your-domain.com`, `your-domain.com` — these cover the
   subdomain) → 15 years → Create. Copy the **Origin Certificate** and **Private Key**
   into local files now — the key is shown only once. They go onto the server in Part 3.

## Part 3 — Server setup

SSH in: `ssh ubuntu@<public-ip>`

### 3.1 Base packages

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 3.2 Docker

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

### 3.3 PostgreSQL 16 (on the host)

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

### 3.4 Firewall: lock down port 5432

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

### 3.5 Install the Cloudflare origin certificate

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/origin.pem       # paste the Origin Certificate
sudo nano /etc/ssl/cloudflare/origin-key.pem   # paste the Private Key
sudo chmod 644 /etc/ssl/cloudflare/origin.pem
sudo chmod 600 /etc/ssl/cloudflare/origin-key.pem
```

The frontend container mounts this directory read-only.

## Part 4 — Deploy

### 4.1 Clone

Use the fine-grained read-only token from Part 0:

```bash
git clone https://<github-username>:<server-token>@github.com/edw-li/personal-finance-dashboard.git ~/personal-finance-dashboard
cd ~/personal-finance-dashboard
```

### 4.2 Configure `.env`

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Fill in every value:

| Variable | Value |
|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | `finance` / `finance` (as created in 3.3) |
| `POSTGRES_PASSWORD` | the password from 3.3 |
| `ENVIRONMENT` | `prod` |
| `SECRET_KEY` | `openssl rand -hex 32` (prod refuses to boot with < 32 bytes) |
| `CORS_ORIGINS` | exactly `https://finance.your-domain.com` (comma-separated if you ever add more; `*` is rejected) |
| `ADMIN_EMAIL` | your login email — **keep this stable**: the seed renames the admin account to match it on every boot, so changing it later changes your login |
| `ADMIN_PASSWORD` | your login password, 8–72 bytes (bcrypt limit) |
| `OCI_*` | backup settings — fill in during Part 6 (values may be blank until then; they're only read by the backup script) |

### 4.3 Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build takes a few minutes (the images build natively on aarch64 — CI only builds
amd64, so this build is the real gate). Compose waits for the backend healthcheck —
which requires migrations and the admin seed to have succeeded — before starting nginx.
If it fails, nothing is silently broken: the command errors and
`docker compose -f docker-compose.prod.yml logs backend` shows why.

### 4.4 Verify

```bash
# Both services up, backend "(healthy)"
docker compose -f docker-compose.prod.yml ps

# Migrations applied, admin seeded, "Application startup complete"
docker compose -f docker-compose.prod.yml logs backend

# API through nginx over TLS (-k: origin cert isn't in the local trust store)
curl -sk https://localhost/api/v1/health     # → {"status":"ok"}

# HTTP redirects to HTTPS
curl -sI http://localhost/ | head -1         # → HTTP/1.1 301 Moved Permanently
```

Then from your own machine: open **https://finance.your-domain.com** and log in with
`ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Part 5 — Updating the app

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

## Part 6 — Nightly backups to OCI Object Storage

### 6.1 Create the bucket

☰ → **Storage → Buckets** → **Create Bucket** → name `finance-db-backups`, keep defaults
(private visibility). On the bucket details page, note the **Namespace** value.

### 6.2 Create S3-compatible credentials

Console top-right profile icon → **My profile** → under Resources: **Customer secret
keys** → **Generate secret key**. Copy the **Access Key** and the **Secret Key** (shown
only once).

### 6.3 Configure and test

On the server, fill the `OCI_*` block in `.env`: the two keys, `OCI_BUCKET_NAME`,
`OCI_NAMESPACE` (from 6.1), and `OCI_REGION` (your region's identifier, e.g.
`us-sanjose-1`, shown in the console's region picker).

```bash
sudo apt-get install -y python3-boto3
chmod +x backend/scripts/backup_db.sh
./backend/scripts/backup_db.sh
```

Expected output ends with `Backup complete.`; the object
`backups/finance_<date>.sql.gz` appears in the bucket. The script keeps 30 days of
backups (each run deletes the dump from 30 days prior).

### 6.4 Schedule

```bash
crontab -e
```

```
0 3 * * * /home/ubuntu/personal-finance-dashboard/backend/scripts/backup_db.sh >> /home/ubuntu/finance-backup.log 2>&1
```

### 6.5 Restore drill (do this once now, and after any schema change you care about)

```bash
# Download a backup: bucket → object → Download (or scp it to the server)
gunzip finance_<date>.sql.gz

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

## Troubleshooting

**Backend unhealthy / compose up fails** — `docker compose -f docker-compose.prod.yml
logs backend`. Alembic or seed errors print there; the healthcheck exists precisely so
these fail the deploy instead of 502ing.

**`no pg_hba.conf entry for host "172.x.y.z"`** — the container's subnet isn't covered.
The `172.16.0.0/12` line in 3.3 covers all Docker bridges; check it was added and
`sudo systemctl restart postgresql`.

**Backend can't reach Postgres at all** — confirm the bridge gateway:
`docker network inspect personal-finance-dashboard_default | grep Gateway`, then check
`listen_addresses` includes `172.17.0.1` (that's what `host.docker.internal` maps to)
and restart Postgres.

**Postgres fails to start after a reboot** — rare race: Postgres binds `172.17.0.1`
before Docker creates the bridge. `sudo systemctl restart postgresql` fixes it; if it
recurs, set `listen_addresses = '*'` (safe here: pg_hba + the iptables DROP still deny
outside access).

**Site unreachable (Cloudflare 521/522)** — Cloudflare can't reach the origin: security
list missing 80/443 (1.3), containers down (`docker compose ps`), or the DNS record
points at the wrong IP.

**Cloudflare 526** — TLS mode is Full (strict) but the origin cert doesn't cover the
subdomain or isn't installed at `/etc/ssl/cloudflare/` (3.5).

**Login fails with a CORS error in the browser console** — `CORS_ORIGINS` must exactly
match `https://finance.your-domain.com` (scheme included, no trailing slash). Edit
`.env`, then `docker compose -f docker-compose.prod.yml up -d` to recreate the backend.

**`start.sh: not found` or exec format errors in the backend container** — CRLF line
endings sneaked into a checkout. Verify on the server: `od -c backend/start.sh | head -2`
must show `\n`, never `\r \n`. (`.gitattributes` prevents this; a Linux clone is safe.)

**Ports 80/443 time out but the security list is right** — Docker's iptables chains were
clobbered (e.g. by restoring saved rules after Docker started): `sudo systemctl restart
docker`.

## Security notes

- The repo is private; the server's GitHub token is fine-grained, read-only, expiring.
- `.env` holds every secret — `chmod 600`, never committed (`.gitignore` +
  `.dockerignore` both exclude it, so it can't leak into the git history *or* image
  build context).
- Postgres: bound to localhost + Docker bridge, scram auth, iptables DROP on 5432, OCI
  security list closed. Only 22/80/443 are reachable from outside.
- All traffic is HTTPS end-to-end (Cloudflare edge cert → origin cert), HSTS enabled.
- The whole app sits behind JWT auth; only `/login` and `/api/v1/health` are public.
- Backups live in a private bucket under scoped S3 credentials. (Optional hardening:
  pipe the dump through `gpg --symmetric` before upload.)
