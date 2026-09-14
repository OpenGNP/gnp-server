# Deploying gnp-server + gnp-client

Both apps live on one VPS. nginx serves the client's static build and
reverse-proxies `/api` (and `/docs`) to gnp-server, which runs as a systemd
service on `127.0.0.1:3000`. There's no domain yet, so everything is served
over plain HTTP on the VPS's IP — `http://<vps-ip>/` for the app,
`http://<vps-ip>/api/...` for the API.

## One-time VPS setup

1. Point a fresh Ubuntu/Debian VPS's SSH access at yourself, then run
   [setup.sh](setup.sh) on it (as root). It installs bun/nginx, creates a
   `deploy` user, clones both repos into `/opt`, installs the
   [systemd unit](gnp-server.service) and [nginx config](nginx.conf), and
   opens the firewall.
2. The script stops partway through for manual steps it can't safely
   automate: writing real secrets into `/opt/gnp-server/.env`, and generating
   an SSH keypair for GitHub Actions to deploy with. Follow its printed
   instructions.
3. Confirm the VPS can already reach the KMUTT DB/MinIO host (VPN connected)
   before starting gnp-server — `DATABASE_URL` will fail to connect otherwise.
4. Add these secrets in **both** the gnp-server and gnp-client GitHub repos
   (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `SSH_HOST` | VPS IP |
   | `SSH_USER` | `deploy` |
   | `SSH_PRIVATE_KEY` | private half of the deploy keypair |
   | `SSH_PORT` | only needed if not 22 |

## What happens on every push to `main`

- **gnp-server** ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)):
  SSHes in, `git reset --hard origin/main`, `bun install`, restarts the
  `gnp-server` systemd service, then polls `/api/health` and fails the run if
  it doesn't come back healthy.
- **gnp-client** (`.github/workflows/deploy.yml` in that repo): builds the
  Vite app in CI with `VITE_API_URL=/api` (relative, since nginx serves both
  same-origin), then rsyncs `dist/` to `/opt/gnp-client/dist` on the VPS.
  nginx picks up the new files immediately — no reload needed.

## Deliberately not automated

- **Database migrations.** `bun run push` is not run by the deploy workflow.
  Schema changes go to a shared prod DB — review them and run `bun run push`
  (or apply a generated migration) by hand after merging.
- **First-time VPS provisioning.** `setup.sh` is meant to be read and run
  once by a human, not by CI.
