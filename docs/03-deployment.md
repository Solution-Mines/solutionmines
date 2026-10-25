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
 │  push ghcr.io/solution-mines/           │
 │         solutionmines:SHA               │
 └───────────────┬─────────────────────────┘
                 │ ssh (pinned host key)
                 ▼
 ┌─────────────────────────────────────────┐
 │ VPS  /opt/solutionmines/deploy.sh       │
 │  1 pull image                           │
 │  2 start the INACTIVE colour            │
 │  3 poll /api/health until commit == SHA │
 │  4 back up + rewrite upstream, nginx -t │
 │  5 nginx -s reload      ← zero downtime │
 │  6 smoke test (commit == SHA), retire   │
 │  any failure → edge as it was, old      │
 │  colour still serving, new torn down    │
 └─────────────────────────────────────────┘
```

---

## Fastest path: live on the IP, in one command

This needs nothing from GitHub — no Actions secrets, no GHCR, no merge to
`main`. On the server, as your normal user (git is the one thing to install
by hand if it is missing; nothing else changes before preflight has run):

```bash
BRANCH=main     # the branch you are deploying; it must have deploy/preflight.sh
git clone --depth 1 -b "$BRANCH" \
  https://github.com/Solution-Mines/solutionmines.git ~/solutionmines
sudo bash ~/solutionmines/deploy/preflight.sh       # read-only
```

Read what preflight says, and its exit code:

- **0, dedicated** — nothing else serves web traffic here. Carry on:

  ```bash
  sudo bash ~/solutionmines/deploy/bring-up.sh "$BRANCH"
  ```

- **3, shared** (or it could not tell) — another site already owns ports 80
  and 443, or preflight could not rule that out. Do **not** force it. Go to
  [Running behind a shared edge proxy](#running-behind-a-shared-edge-proxy).
  `bring-up.sh` would refuse here anyway, before changing anything.

`sudo bash ~/solutionmines/deploy/survey.sh` prints the same verdict plus an inventory of what
is on the box, which is the thing to read before deciding.

`bring-up.sh` runs preflight again itself, then fetches the branch into
`/opt/solutionmines-src` and checks **that** tree again before running any of
it — the code that acts is the code that checked. A branch that predates
these checks is refused. It bootstraps the box if that has not happened yet,
builds the image **on the server**, and runs the same blue/green deploy CI
would have run. When it finishes it prints the URL. Open `http://<server-ip>`
— port 80, no port number.

Building on the server is deliberately not the long-term design (see the top
of this file): it is slow and can OOM on a small box while the live site
shares the machine, which is why the script adds swap before the build if RAM
is tight (only after both preflight checks have passed; on a shared box only
with `SM_ALLOW_SWAP=1`). A branch that predates the shared-box checks
(no `deploy/guard.sh` or `deploy/preflight.sh`) is refused after the fetch
but before it is checked out, so the scripts in `/opt/solutionmines-src`
(which the rebuild below runs) never become the unguarded ones. If the second
check refuses, the only thing written is the checkout in
`/opt/solutionmines-src`, and the refusal says so. On a dedicated box it runs
`bootstrap.sh` whenever nginx, this site's nginx site or its upstream file is
missing, so a box first set up in shared-edge mode gets them once its
`edge.env` is removed.

It reads three settings from the environment: `SITE_URL` (the canonical
origin baked into the image; default `http://<server-ip>`), `SITE_ENV`
(default `staging`, which serves robots.txt `Disallow: /`) and `REPO_URL`.
Once the domain and TLS are live, rebuild once for the real origin:

```bash
sudo SITE_URL=https://yourdomain.com SITE_ENV=production \
  bash /opt/solutionmines-src/deploy/bring-up.sh "$BRANCH"
```

It exists because "live today on the IP" beats "live next week through a
perfect pipeline". Every deploy after this one goes through CI properly once
the secrets below are set.

**`http://<server-ip>:3001` will not work, and that is correct.** The app
binds to `127.0.0.1`, so only nginx can reach it. Everything from outside
arrives on port 80, and later 443.

---

## The full pipeline

### 1. On the server, once

```bash
git clone -b main https://github.com/Solution-Mines/solutionmines.git ~/solutionmines
sudo bash ~/solutionmines/deploy/preflight.sh      # 0 = dedicated; 3 = see the shared-edge section
sudo bash ~/solutionmines/deploy/bootstrap.sh
```

Refuses, changing nothing, on a box that already serves another site, or
where preflight could not rule that out ("cannot verify": exit 3, or exit 1
when it could not check TCP 3001/3002 either); preflight's report says which,
and a "cannot verify" is fixed and re-run, not forced. It also refuses when
preflight itself broke (exit 1). Otherwise installs
Docker, nginx and certbot; lays out `/opt/solutionmines`; creates a `deploy`
user whose sudo rights are **exactly one script**, not a general root grant;
and brings nginx up HTTP-only so the first deploy can be verified on the bare
IP before DNS moves. Re-running it is safe, and never swaps a TLS site back
to HTTP-only.

**What preflight needs, and what it says.** Run it as root, with `ss`
(package iproute2), with `nft` (package nftables), and with the NAT rules of
**both** address families readable: for IPv4 either `iptables-save` (its
`nat` and `mangle` tables) or `nft`, and the same for IPv6 with
`ip6tables-save`. `nft` is required in any case: native nftables tables
(firewalld's forward ports, LXD, podman's netavark, Docker's nftables backend,
a hand-written `/etc/nftables.conf`) never show in `iptables-save`, so
without a working `nft list ruleset` it answers "cannot verify" (install it
with `sudo apt-get install nftables`; preflight only reads the ruleset). The
one exception is a kernel that provably has no nf_tables at all. Rules in the
kernel's legacy tables (listed in `/proc/net/ip_tables_names` and
`ip6_tables_names`) are invisible to nft, so those are read with
`iptables-legacy-save` / `ip6tables-legacy-save`. Whatever it cannot read it
answers "cannot verify", which counts as shared. It reads no environment
variable (variables and exported shell functions are dropped, and it sets its
own `PATH`); the scripts run it under `env -i`, and `sudo` drops the rest, so
run it by hand as `sudo bash preflight.sh`. Exit 0 means dedicated, 3 means shared *or* not verifiable, anything
else means preflight itself broke (and every script refuses). With `--emit`
it prints exactly three lines, which is what the scripts read:

```
SHARED=yes|no
APP_PORTS_FREE=yes|no     TCP 3001 and 3002 free (no listener, container or NAT rule
                          takes them), or held only by solutionmines-blue / -green
SSH_PORTS=22              where sshd listens (sshd -T's listenaddress lines; loopback
                          left out); information only, nothing acts on it
```

It also answers "cannot verify" when:

- the docker CLI is installed but `dockerd` is not running. It never calls
  docker then: after `systemctl stop docker`, `docker.socket` still listens,
  and the first `docker ps` would start the daemon and every container with a
  restart policy. Start Docker yourself (`sudo systemctl start docker`) and
  re-run. A `docker ps`, `docker ps -a` or `docker inspect` that fails is
  treated the same way;
- `nginx -T` fails, or prints something it cannot tokenize. That includes any
  `*_by_lua_block`: its body is Lua, not nginx syntax;
- the nginx holding :80/:443 was started with a command line other than the
  packaged ones (`nginx`, or `/usr/sbin/nginx`, optionally with
  `-g 'daemon on; master_process on;'` and `-c /etc/nginx/nginx.conf`). A `-g`
  can load more configuration that a plain `nginx -T` never shows.

It counts the box as shared, too, when something is set up to take :80/:443
without holding them right now:

- a container, running or not, whose configuration publishes host port 80 or
  443 (a crash-looping proxy shows no ports in `docker ps`, and a stopped one
  with a restart policy comes back at the next boot). A leftover container
  you do not need: `sudo docker rm <name>`. A container on the host's network
  counts while it runs, or when its restart policy brings it back;
- an enabled web server unit (caddy, apache2, haproxy, traefik, lighttpd,
  openresty, envoy, angie, h2o) that is down at the moment;
- a container orchestrator: Kubernetes, k3s, rke2, Cilium or Calico (their
  processes, `/etc/kubernetes`, `/var/lib/kubelet`, `/etc/rancher`,
  `/var/lib/rancher`, Cilium's pinned eBPF maps). With an eBPF dataplane the
  ports they publish show neither a socket nor a NAT rule.

For TCP 3001/3002, only the NAT rule Docker itself writes for a running
solutionmines-blue (3001) or -green (3002) counts as ours: in Docker's own
chain, for 127.0.0.1, to that container's address and port 3000, once.

**Which server blocks count as ours.** Preflight compares the server blocks in
everything `nginx -T` prints with the blocks in the files that are provably
ours or the untouched stock default, and only counts a file whose exact text
nginx dumps under its own path. A file that is merely on disk (a stock
`sites-enabled/default` left behind under an `nginx.conf` that no longer
includes it) vouches for nothing. The stock default counts only when
nginx-common itself owns it, unmodified and not diverted, **and** what it
serves is nobody's: `/var/www/html` is absent, or a real directory holding
nothing but nginx's welcome page (`index.nginx-debian.html`, byte for byte
`/usr/share/nginx/html/index.html`). A static site copied into `/var/www/html`
behind the untouched default site is someone's site. If all that is left there
is an old copy of the welcome page, remove it and re-run. `/etc/nginx` (or
`sites-available`) may be a symlink, to a directory kept under configuration
management for instance; our site still counts as ours. With no nginx binary
installed, the leftover configuration is read the way the stock `nginx.conf`
loads it, `modules-enabled/*.conf` and `mime.types` included.

**Where bootstrap puts nginx's files.** Only these, so preflight can tell
them apart from anyone else's:

| File | Path |
|---|---|
| site (HTTP-only, later TLS) | `/etc/nginx/sites-available/solutionmines`, enabled as the symlink `/etc/nginx/sites-enabled/solutionmines` |
| rate-limit zones + upstream block | `/etc/nginx/conf.d/solutionmines-zones.conf` |
| proxy settings | `/etc/nginx/snippets/solutionmines-proxy.conf` |
| live colour, rewritten by `deploy.sh` | `/etc/nginx/solutionmines/upstream.conf` |

Do not copy the site into `sites-enabled` as a plain file: preflight counts
that as someone else's site. `guard.sh` and `preflight.sh` are installed next
to `deploy.sh` in `/opt/solutionmines`.

**A box set up by an earlier version** of these scripts has
`conf.d/solutionmines-proxy.conf` and `conf.d/solutionmines-upstream.conf`.
That layout fails `nginx -t` on a stock `nginx.conf`, so preflight cannot read
what nginx serves and refuses. The refusal then prints the migration by hand
(it is what bootstrap would do, but nothing may change before preflight has a
verdict). If the only reason preflight gives is that `nginx -T` failed:

```bash
sudo install -d -m 0755 /etc/nginx/solutionmines /etc/nginx/snippets
sudo sh -c "grep -Eo 'server 127\.0\.0\.1:300[12];' /etc/nginx/conf.d/solutionmines-upstream.conf | head -1 > /etc/nginx/solutionmines/upstream.conf"
sudo sh -c "[ -s /etc/nginx/solutionmines/upstream.conf ] || echo 'server 127.0.0.1:3001;' > /etc/nginx/solutionmines/upstream.conf"
sudo mv /etc/nginx/conf.d/solutionmines-proxy.conf /etc/nginx/snippets/solutionmines-proxy.conf
sudo rm -f /etc/nginx/conf.d/solutionmines-upstream.conf
sudo sed -i 's#/etc/nginx/conf.d/solutionmines-upstream.conf#/etc/nginx/solutionmines/upstream.conf#' /etc/nginx/conf.d/solutionmines-zones.conf
sudo sed -i 's#/etc/nginx/conf.d/solutionmines-proxy.conf#/etc/nginx/snippets/solutionmines-proxy.conf#g' /etc/nginx/sites-available/solutionmines
sudo nginx -t
```

then re-run. From then on preflight passes with no override.

**The `deploy` user.** Bootstrap creates it. If an account called `deploy`
already exists on a box this site was never set up on, it belongs to someone
else, and bootstrap (and bring-up) refuse before changing anything rather
than give it sudo rights and an `authorized_keys` file. If that account
really is meant for this site's CI, re-run with `SM_DEPLOY_USER_OK=1`; its
group memberships are left alone.

**The firewall is yours.** Bootstrap never installs ufw, never switches a
firewall on, and never touches iptables or nftables. If ufw is *already*
active it adds `Nginx Full` (80 and 443). If another manager runs this box's
firewall (firewalld, nftables.service or netfilter-persistent, as on many
cloud images whose INPUT policy drops all but SSH), it says so and prints how
to open 80/tcp and 443/tcp in **that** one, never ufw: two managers fight
over the same tables, and installing ufw removes netfilter-persistent. A
provider's firewall or security group in front of the box needs 80 and 443
too; bring-up checks the site through `127.0.0.1` only, so open the address
from another machine before running `enable-tls.sh`, or the certificate's
HTTP-01 check fails. Otherwise it prints the commands to
run by hand — and the order matters: allow the port sshd actually listens on
**first** (preflight reports it; confirm with `sudo ss -ltnp | grep -E
'sshd|systemd'`, since a socket-activated `ssh.socket` shows up as systemd),
then `Nginx Full`, then anything else the box must keep reachable (a VPN,
mail), and only then `ufw enable`. Switching a firewall on blind is how people
lock themselves out of a box on a non-standard SSH port or behind a WireGuard
tunnel. Whether ufw is active is read in the C locale, so a box installed in
another language is recognised too.

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

Images publish as `ghcr.io/solution-mines/solutionmines:<sha>` — the name
comes from `github.repository`, lowercased, so it followed the repository
when it moved to the Solution-Mines organisation. A package an organisation's
Actions push is **private by default**, so the first `docker pull` on the
server 401s, which looks like a broken deploy rather than a permissions
setting. Pick one:

- **Simplest:** after the first successful build, open the package under the
  organisation's *Packages*, and set its visibility to public. Nothing else
  to do. (The organisation may need to allow public packages first.)
- **Or** fill in `/opt/solutionmines/registry.env` with `GHCR_USER` and a
  classic PAT scoped to `read:packages`, for an account that can read that
  package. `deploy.sh` logs in when it finds it.

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

Add `AAAA` records only if they point at this server's own IPv6 address, and
remove any the registrar created for parking: Let's Encrypt validates over
IPv6 when there is an AAAA record, so a stray one fails the certificate.

Nothing is indexable until step 7: the HTTP-only config sends
`X-Robots-Tag: noindex` on every response.

### 7. TLS, once DNS resolves to the box

```bash
sudo /opt/solutionmines/enable-tls.sh yourdomain.com you@yourdomain.com
```

It refuses on a shared-edge box, and runs preflight again first: a box that
was dedicated at bootstrap may have gained another site since, and the TLS
config claims `default_server` on 443. It refuses to run unless both the
domain and `www.` resolve here — every A record to this server's IPv4, every
AAAA record to one of its own IPv6 addresses — rather than burning Let's
Encrypt's five-failures-per-hour budget on a propagation delay or a stray
record. It then issues for apex + www (with a deploy hook that reloads nginx
on every renewal), installs the TLS config only after `nginx -t` accepts it —
putting the old one back if not, and copying the file it replaces to
`/opt/solutionmines/site-backup.<time>.<random>` first, which nothing deletes
even if the reload fails — and runs `certbot renew --dry-run`,
because a renewal that silently fails takes the site dark in 90 days. It is
not in the `deploy` user's sudo grant: run it yourself, as root.

Re-running it is safe: once the TLS site for the domain is installed it is
kept as it is, so the HSTS line you enabled and an enforced CSP stay. To
re-render it from the template, move the site file aside first.

Afterwards, set `NEXT_PUBLIC_SITE_URL` to the real origin and redeploy (or,
without CI yet, re-run `bring-up.sh` with `SITE_URL` and `SITE_ENV=production`
as shown under the fastest path), or every canonical tag still points at the
placeholder.

---

## Running behind a shared edge proxy

Everything above assumes this server is the site's own. When the box already
runs other services, one of them owns ports 80 and 443 and the rest cannot
have them — so `bootstrap.sh` must not install its nginx, and `deploy.sh`
cannot reload nginx or smoke-test port 80. This is where preflight's exit 3
leads.

The fix is not a different port per service. It is **one proxy that owns 80
and 443, and services it reaches by container name** over a shared docker
network, so there is no port to allocate and nothing to collide.

### What shared-edge mode does and does not touch

The mode is on whenever `/opt/solutionmines/edge.env` exists. Then:

- no nginx, no certbot, no firewall change, no `/var/www/certbot`;
- **no Docker install**: Docker must already be on the box. Its installer
  rewrites the iptables `FORWARD` policy, which can cut off the other site;
  that is a decision for whoever runs the box, so bootstrap refuses instead;
- the `edge` docker network is created if missing (additive), and the proxy
  has to join it;
- `bring-up.sh` adds no swap unless you pass `SM_ALLOW_SWAP=1`;
- TCP 3001 and 3002 must be free (or held by this site's own containers):
  both colours publish there, and preflight's `APP_PORTS_FREE` is checked
  before anything happens. A NAT rule that takes either port (a podman
  publish, an `OUTPUT` DNAT, kube-proxy rules with no port match) counts as
  taken.

### edge.env: five keys, no defaults

```bash
sudo install -d -m 0755 /opt/solutionmines
sudo cp ~/solutionmines/deploy/edge.env.example /opt/solutionmines/edge.env
sudo chmod 600 /opt/solutionmines/edge.env
sudoedit /opt/solutionmines/edge.env
```

`deploy.sh` sources this file as root, so it is refused unless it and its
directory are owned by root and neither is writable by group or others.

Every key must be set explicitly, and every script checks the file before it
acts (`sm_check_edge_env` in `deploy/guard.sh`, which prints every problem at
once). An unedited copy, with everything still commented out, is refused —
it used to switch edge mode on and then quietly fall back to *this* site's
nginx paths, which on a shared box means writing into and reloading somebody
else's proxy.

| Key | Rule |
|---|---|
| `UPSTREAM_FILE` | Absolute path in a directory that exists and is **its own**: it holds nothing but this file. Never in a directory the proxy loads whole: `/etc/nginx/conf.d`, `sites-enabled`, `sites-available`, or anything a Caddyfile imports by glob (`import sites/*.caddy`). A bare upstream line in such a directory breaks the other site's config. This site's block imports the file by exact path instead. That directory and every one above it must be owned by root and not writable by group or others (a sticky `/tmp`-style parent is fine): `deploy.sh` writes there as root. If the file exists, it must hold exactly the line for blue or green, which is what the steps below create; anything else (another site's upstream include, the proxy's main config) is refused. |
| `UPSTREAM_LINE` | The line `deploy.sh` writes. Must contain `__COLOUR__` (blue/green) or `__PORT__` (3001/3002). |
| `EDGE_TEST_CMD` | Validates the proxy config. Run before the deploy touches anything (an edge that already fails is refused), after the new line is written, and again after any restore. |
| `EDGE_RELOAD_CMD` | Graceful reload. |
| `SMOKE_URL` | `http(s)://` through the proxy, by a **hostname** this site's block matches — never `127.0.0.1` or plain `localhost`, which reach the catch-all, and never port 3001 or 3002, which is the container itself. A local alias such as `sm.localhost` works before DNS does. The response must report the commit just deployed, so a catch-all's empty 200 no longer passes. |

`deploy.sh` backs the upstream file up byte for byte before writing it. A
failed config test puts it back, with its owner and mode (or removes it, if
there was none) and re-tests, before anything reloads. The file is replaced
by a rename, so it gets a new inode each time: a proxy in a container must
mount the **directory** that holds it, never the single file. A failed reload or smoke test restores
it, reloads, and tears the new colour down, and so does anything else that
ends the deploy between the write and a passing smoke test: a command that
fails, or the deploy being killed (CI cancelled, the SSH session dropped).
A failed deploy leaves the edge exactly as it found it. When the edge had
already been switched to the new colour, it is drained for `DRAIN_SECONDS`
after the rollback before it is torn down. If the upstream file cannot be put
back (a full disk, an I/O error), `deploy.sh` says so, does not claim a
rollback, keeps the backup and prints the command to restore it, and leaves
the new colour running for whatever the edge sends it.

### Caddy, in a container

```
/opt/edge/                 mounted at /etc/caddy in the proxy container
  Caddyfile                import sites/*.caddy   + the catch-all below
  sites/
    <site-a>.caddy
    solutionmines.caddy    this site's block (below)
  upstreams/
    solutionmines.caddy    UPSTREAM_FILE: one line, rewritten by deploy.sh
docker network edge        shared; the proxy and every stack join it
```

`upstreams/` sits **outside** the `sites/*.caddy` glob. Caddy reads it only
through this site's block, which imports it by its path inside the container:

```
# /opt/edge/sites/solutionmines.caddy
solutionmines.com, www.solutionmines.com, http://sm.localhost {
	import /etc/caddy/upstreams/solutionmines.caddy
}
```

Create the upstream file **before** adding that block — Caddy refuses a
config whose import is missing — and give it the line for blue:

```bash
sudo install -d -m 0755 /opt/edge/upstreams
echo 'reverse_proxy solutionmines-blue:3000' | sudo tee /opt/edge/upstreams/solutionmines.caddy
sudo docker network connect edge <proxy-container>
```

The matching `edge.env` is Example A in `deploy/edge.env.example`:
`UPSTREAM_FILE=/opt/edge/upstreams/solutionmines.caddy` (the host path,
which is what `deploy.sh` writes), `UPSTREAM_LINE='reverse_proxy
solutionmines-__COLOUR__:3000'`, `caddy validate` / `caddy reload` through
`docker exec`, and `SMOKE_URL=http://sm.localhost/api/health`. The blue/green
switch is then a rewrite of one `reverse_proxy` line plus a `caddy reload` —
the same zero-downtime semantics as the nginx include, because a reload in
either server drains existing workers rather than dropping them.

**Give the edge an explicit catch-all that 404s.** Caddy answers an unmatched
`Host` with an empty **200**, so a site file that is missing or has a typo in
its hostname looks indistinguishable from a healthy server returning a blank
page:

```
:80 {
	respond "no site is configured for this host" 404
}
```

### Another site's nginx, on the host

Same idea: a directory of its own, included by exact path from this site's
server block. Example B in `deploy/edge.env.example` is the matching config.

```nginx
# e.g. /etc/nginx/sites-available/solutionmines, enabled by its owner
upstream solutionmines_app {
    include /etc/nginx/solutionmines/upstream.conf;   # UPSTREAM_FILE
    keepalive 16;
}
server {
    listen 80;
    server_name solutionmines.com www.solutionmines.com sm.localhost;
    location / {
        proxy_pass http://solutionmines_app;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Create `/etc/nginx/solutionmines/upstream.conf` containing
`server 127.0.0.1:3001;` before enabling the block.

### Then

Re-run `sudo bash ~/solutionmines/deploy/bring-up.sh "$BRANCH"`. It deploys
straight away, so the site block and `SMOKE_URL` must be in place first.

Two things that still hold:

- **Keep the `127.0.0.1:3001` / `:3002` publications.** A proxy on the
  `edge` network does not use them, but `deploy.sh` health-checks the new
  colour on them *before* the switch, which is what makes a bad image fail
  without ever taking traffic.
- **`SMOKE_URL` must go through the proxy**, not to the container. Checking
  the container twice proves nothing about whether the switch actually
  worked.

What does NOT change: the image, the health check, the commit assertion, the
rollback, or the order of operations. Only where the upstream is written and
how the edge is reloaded.

## Operating it

**Roll back** — deploys are immutable per-SHA tags, so a rollback is a deploy
of the old one:

```bash
sudo /opt/solutionmines/deploy.sh ghcr.io/solution-mines/solutionmines:<OLD_SHA> <OLD_SHA>
```

**One deploy at a time.** `deploy.sh` holds a lock
(`/opt/solutionmines/.deploy.lock`) for its whole run, so a manual rollback,
a bring-up and a CI deploy cannot interleave: the second one refuses, having
changed nothing, and can simply be re-run once the first has finished.

**Redeploying the live commit** (a CI re-run, a bring-up re-run): both colours
then report the same commit, so the old colour is paused for the few seconds
of the smoke test. Only the new colour can answer through the edge, and a
switch that did not take effect fails and rolls back instead of retiring the
colour that is still serving.

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

**Why `deploy` is not in sudoers generally.** It gets exactly `deploy.sh` —
the one thing CI runs. Not `enable-tls.sh`, which CI never calls, and not the
`docker` group either: membership is root in all but name
(`docker run -v /:/host`). A compromised CI token should not be a root shell
on the box.

**Why bootstrap never switches a firewall on.** Preflight can see TCP and UDP
listeners, but not what the owner reaches the box through, which rules an
inactive ufw already holds, or whether another tool (netfilter-persistent,
firewalld) manages the tables. Enabling ufw blind risks locking the owner
out; installing it can remove netfilter-persistent. So bootstrap only adds
to a firewall that is already on, and otherwise prints the commands, SSH
first.

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
