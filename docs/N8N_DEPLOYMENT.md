# N8N_DEPLOYMENT.md — n8n Deployment Guide (v0.1)

## Access Strategy for v0.1

### Why SSH tunnel first

n8n does not need to be publicly accessible for the v0.1 manual pipeline.
The operator is the only user. Exposing n8n on a public port without HTTPS and
authentication hardening creates unnecessary attack surface before the pipeline is even tested.

An SSH tunnel routes traffic from your local machine to the VPS over an encrypted connection.
n8n is bound to `127.0.0.1:5678` — unreachable from the internet, only reachable via the tunnel.

### Why domain and HTTPS are postponed

Public HTTPS requires a domain, a TLS certificate (e.g. Let's Encrypt), and a reverse proxy
(e.g. nginx or Caddy). This adds setup time and configuration complexity.

These are only needed when:
- Apify or Telegram need to call a webhook endpoint on n8n
- Google OAuth requires a verified HTTPS redirect URI
- The pipeline needs to run unattended and be monitored remotely

None of these apply to v0.1. Domain and HTTPS will be added at that point.

---

## Deployment Steps

### 1. Copy example files to your deployment directory

Run these commands on the VPS (operator runs — not the agent):

```bash
mkdir -p /opt/n8n
cp /opt/marketing-scout-agent/scripts/docker-compose.n8n.example /opt/n8n/docker-compose.yml
cp /opt/marketing-scout-agent/scripts/n8n.env.example /opt/n8n/n8n.env
```

### 2. Generate the encryption key

n8n requires an encryption key to store credentials. Generate one:

```bash
openssl rand -hex 32
```

Copy the output. Open `/opt/n8n/n8n.env` and replace:
```
N8N_ENCRYPTION_KEY=REPLACE_WITH_OUTPUT_OF_openssl_rand_-hex_32
```
with the generated value. Do not share or commit this value.

**Important:** If you change this key after n8n has stored credentials, all stored credentials
will become unreadable. Generate it once and keep it.

### 3. Review n8n.env

Confirm the timezone is correct (`GENERIC_TIMEZONE`, `TZ`).
All other values in the example are safe defaults for v0.1 and do not need to change.

### 4. Start n8n

```bash
cd /opt/n8n
docker compose up -d
```

Verify the container started:
```bash
docker compose ps
```

### 5. Check logs

```bash
docker compose logs -f n8n
```

n8n is ready when the logs show something like:
```
Editor is now accessible via:
http://localhost:5678/
```

### 6. Open n8n in your local browser via SSH tunnel

Run this on your **local machine** (not the VPS):

```bash
ssh -L 5678:127.0.0.1:5678 root@SERVER_IP
```

Then open in your browser:
```
http://localhost:5678
```

The tunnel must remain open while you use the n8n UI. Open a separate terminal for other work.

---

## Updating n8n

To update the n8n image:

```bash
cd /opt/n8n
docker compose pull
docker compose up -d
```

Workflow data and credentials are stored in the `n8n_data` Docker volume and are preserved
across updates.

---

## What Not to Commit to Git

| File / Path             | Reason                                              |
|-------------------------|-----------------------------------------------------|
| `n8n.env`               | Contains real encryption key — never commit         |
| `docker-compose.yml`    | May contain real paths or values — keep outside repo|
| `n8n_data/` volume      | Runtime data managed by Docker, not Git             |
| Any credential values   | Credentials live in n8n UI only, not in files       |

Add to `.gitignore` in any repo that includes n8n config:
```
n8n.env
docker-compose.yml
*.tar.gz
```

---

## Adding Public Domain and HTTPS Later

When webhooks, OAuth, or production access are needed:

1. Point a domain at the VPS IP (e.g. `n8n.yourdomain.com`)
2. Set up a reverse proxy (nginx or Caddy) to handle TLS termination
3. Update `n8n.env`:
   - `N8N_HOST=n8n.yourdomain.com`
   - `N8N_PROTOCOL=https`
   - `N8N_SECURE_COOKIE=true`
4. Obtain a TLS certificate (Caddy does this automatically; nginx requires Certbot)
5. Update n8n's webhook URL setting if using Apify or Telegram webhooks

This is deferred until v0.2 or when a specific integration requires it.

---

## Template Files Location

| File                                    | Purpose                              |
|-----------------------------------------|--------------------------------------|
| `scripts/docker-compose.n8n.example`   | Docker Compose template for n8n      |
| `scripts/n8n.env.example`              | Environment variable template        |
| `docs/N8N_DEPLOYMENT.md`              | This guide                           |
