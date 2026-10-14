# Deployment runbook

**Shape:** GitHub Actions builds a Docker image → pushes it to GHCR → SSHes to
the VPS → blue/green switch behind nginx → verifies, or rolls back.

Nothing is ever built on the server. A `next build` on a small VPS is slow at
best and an OOM at worst, while the live site is sharing the box.

```
 push to main
      │
      ▼
 ┌─────────────────────────────────────────┐
 │ GitHub Actions                          │
 │  guard: NEXT_PUBLIC_SITE_URL is set     │
 │  docker build  (SITE_ENV, SITE_URL,     │
 │                 GIT_COMMIT_SHA baked)   │
 │  push ghcr.io/<owner>/solutionmines:SHA │
 └───────────────┬─────────────────────────┘
                 │ ssh (pinned host key)
                 ▼
 ┌─────────────────────────────────────────┐
 │ VPS  /opt/solutionmines/deploy.sh       │
 │  1 pull image                           │
 │  2 start the INACTIVE colour            │
 │  3 poll /api/health until commit == SHA │
 │  4 rewrite nginx upstream, nginx -t     │
 │  5 nginx -s reload      ← zero downtime │
 │  6 smoke test, then retire old colour   │
 │  any failure before 4 → old colour      │
 │  still serving, new one torn down       │
 └─────────────────────────────────────────┘
```

---

## What you need to do

### 1. On the server, once

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/azariahjerish/solutionmines.git /opt/solutionmines-src
sudo bash /opt/solutionmines-src/deploy/bootstrap.sh
```

Installs Docker, nginx, certbot and ufw; lays out `/opt/solutionmines`; creates
a `deploy` user whose sudo rights are **exactly two scripts**, not a general
root grant; and brings nginx up HTTP-only so the first deploy can be verified
on the bare IP before DNS moves.

### 2. Give CI a key

On your own machine (not the server, not here):

```bash
ssh-keygen -t ed25519 -C "github-actions-solutionmines" -f ./sm_deploy -N ""
```

Public half onto the server:

```bash
sudo tee -a /home/deploy/.ssh/authorized_keys < sm_deploy.pub
```

Host key for pinning — run **on the server**, copy the output:

```bash
ssh-keyscan -t ed25519 <SERVER_IP>
```

### 3. Repository settings

**Settings → Secrets and variables → Actions**

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the server's IP or hostname |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | contents of the **private** `sm_deploy` file |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output from step 2 |

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://yourdomain.com` — no trailing slash |
| `SITE_ENV` | `production` (anything else makes robots.txt `Disallow: /`) |

`NEXT_PUBLIC_SITE_URL` is **baked into the image at build time**, because the
routes that use it are statically generated. Changing it means a rebuild, not a
restart. The deploy workflow refuses to start without it.

### 4. Mail

`/opt/solutionmines/app.env` was created empty and `chmod 600`. Fill it in:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=hello@yourdomain.com
MAIL_FROM_NAME=SolutionMines
CONTACT_RECIPIENT_EMAIL=you@yourdomain.com
```

Leave **all** of it blank and enquiries are logged to stdout with a warning.
Fill in **some** of it and the container refuses to start, naming the missing
key — which the deploy health check catches and rolls back. That is deliberate:
a half-configured mail setup looks healthy and silently destroys leads.

`MAIL_FROM` must be on a domain you control, with SPF, DKIM and DMARC set up,
or the mail lands in spam. See `docs/02-email-deliverability.md`.

### 4b. Let the server pull the image

A package pushed to GHCR by Actions is **private by default, even when the
repository is public** — so the first `docker pull` on the server 401s, which
looks like a broken deploy rather than a permissions setting. Pick one:

- **Simplest:** after the first successful build, open the package under the
  repo's *Packages*, and set its visibility to public. Nothing else to do.
- **Or** fill in `/opt/solutionmines/registry.env` with `GHCR_USER` and a
  classic PAT scoped to `read:packages`. `deploy.sh` logs in when it finds it.

### 5. Deploy

Push to `main`, or run the **Deploy** workflow manually. Then:

```bash
curl -s http://<SERVER_IP>/api/health
```

Expect `"status":"ok"` and a `commit` matching the SHA you deployed.

### 6. DNS — your part

```
A    @      <SERVER_IP>
A    www    <SERVER_IP>
```

Nothing is indexable until step 7: the HTTP-only config sends
`X-Robots-Tag: noindex` on every response.

### 7. TLS, once DNS resolves to the box

```bash
sudo /opt/solutionmines/enable-tls.sh yourdomain.com you@yourdomain.com
```

It refuses to run if the domain does not resolve here yet, rather than burning
Let's Encrypt's five-failures-per-hour budget on a propagation delay. It then
issues for apex + www, installs the TLS config, and runs `certbot renew
--dry-run` — because a renewal that silently fails takes the site dark in 90
days.

Afterwards, set `NEXT_PUBLIC_SITE_URL` to the real origin and redeploy, or
every canonical tag still points at the placeholder.

---

## Operating it

**Roll back** — deploys are immutable per-SHA tags, so a rollback is a deploy
of the old one:

```bash
sudo /opt/solutionmines/deploy.sh ghcr.io/<owner>/solutionmines:<OLD_SHA> <OLD_SHA>
```

**Which build is live?**

```bash
curl -s https://yourdomain.com/api/health
cat /opt/solutionmines/image.env
```

**Logs**

```bash
docker compose -f /opt/solutionmines/docker-compose.yml logs -f
```

Capped at 10 MB × 5 files per container. Unbounded container logs filling the
disk is a common way a small VPS dies quietly.

**After a reboot** `solutionmines.service` restores only the colour the last
successful deploy recorded — not both halves of the pair.

---

## Decisions worth knowing

**Why blue/green rather than `docker compose up -d`.** A plain recreate has a
window where nothing answers, and if the new image is broken you have already
destroyed the thing that was working. Here the new container has to prove
itself on `/api/health` — *and report the SHA you just built*, which is what
catches a stale tag or a no-op pull — before nginx is touched. Until the
`nginx -s reload`, every failure path leaves the old container serving.

**Why `nginx -s reload` and not a restart.** Reload hands existing workers
their in-flight requests to finish and starts new ones on the new upstream. It
is genuinely zero-downtime rather than a fast restart.

**Why the host key is pinned.** `StrictHostKeyChecking=no` would make every
deploy man-in-the-middleable by anyone who can answer on that address, and what
is being handed over is a command that runs as root on production.

**Why `deploy` is not in sudoers generally.** It gets exactly `deploy.sh` and
`enable-tls.sh`. A compromised CI token should not be a root shell on the box.

**Why HSTS and CSP ship disabled.** HSTS is effectively irreversible for the
max-age you publish, so it is enabled only after a renewal dry-run passes. CSP
ships `Report-Only` because an enforced policy on day one breaks things nobody
notices until a visitor does.

**Why the app ports are bound to 127.0.0.1.** Docker publishes ports by
writing iptables rules that bypass ufw entirely — a `ports: "3001:3000"` would
be reachable from the internet with no TLS and no rate limit, and `ufw status`
would still say the port is blocked. Binding to `127.0.0.1` in the compose
file is what actually prevents that, not the firewall.

**Why Debian slim and not Alpine.** `sharp` — which the image optimiser needs
the moment a real image is added — links against libvips/glibc, and musl is a
documented source of image-optimisation failures that only appear in
production. Note `sharp` is **not currently a dependency**, because the site
ships no raster images yet; add it before adding the first one.

---

## Not done here

- **Analytics.** Self-hosted Umami was specified in the plan. It needs Postgres
  on the box and is a separate decision.
- **Staging.** One environment only. Staging needs its own build, because
  `NEXT_PUBLIC_SITE_URL` and `SITE_ENV` are compiled in — the same image cannot
  serve both.
- **Off-box backups.** There is no database yet; the only state is
  `app.env`. Back it up somewhere, because it is the one file not in git.
