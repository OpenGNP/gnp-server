# Deploying gnp-server + gnp-client (Docker)

Both apps run as Docker containers on one VPS, orchestrated by
[docker-compose.yml](docker-compose.yml). CI builds each image and pushes it
to GitHub Container Registry (GHCR); the VPS only ever pulls, never builds.
gnp-client's nginx serves the static build and reverse-proxies `/api` (and
`/docs`) to gnp-server over the Docker network — see
[../../gnp-client/deploy/nginx.conf](../../gnp-client/deploy/nginx.conf).
There's no domain yet, so everything is served over plain HTTP on the VPS's
IP — `http://<vps-ip>/` for the app, `http://<vps-ip>/api/...` for the API.

## Images

- `ghcr.io/opengnp/gnp-server` — built from [../Dockerfile](../Dockerfile)
- `ghcr.io/opengnp/gnp-client` — built from
  [../../gnp-client/Dockerfile](../../gnp-client/Dockerfile) (multi-stage:
  `bun run build` → static files served by nginx)

Each deploy workflow pushes both `:latest` and `:<commit-sha>` tags, so a bad
deploy can be rolled back by pointing `docker-compose.yml` at an older sha tag
and running `docker compose up -d` again.

## One-time VPS setup

1. Run [setup.sh](setup.sh) on a fresh Ubuntu/Debian VPS (as root). It
   installs Docker + the Compose plugin, creates a `deploy` user (added to
   the `docker` group), and opens the firewall.
2. It stops partway through for manual steps it can't safely automate:
   copying `docker-compose.yml` to `/opt/gnp/`, writing real secrets into
   `/opt/gnp/.env`, logging in to GHCR (`docker login ghcr.io`), and
   generating an SSH keypair for GitHub Actions. Follow its printed
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

   `GITHUB_TOKEN` (used to push to GHCR) is automatic — no secret needed for
   that part.

## What happens on every push to `main`

Both `.github/workflows/deploy.yml` (one per repo) do the same two steps:

1. **Build + push.** Build the Docker image and push `:latest` +
   `:<sha>` to GHCR.
2. **Deploy.** SSH into the VPS, `docker compose pull <service>` +
   `docker compose up -d <service>` for just that one service (so a client
   deploy doesn't restart the server and vice versa). gnp-server's workflow
   then polls `http://127.0.0.1:3000/api/health` and fails the run if it
   doesn't come back healthy.

## Deliberately not automated

- **Database migrations.** `bun run push` is not run by the deploy workflow.
  Schema changes go to a shared prod DB — review them and run `bun run push`
  (or apply a generated migration) by hand after merging.
- **First-time VPS provisioning.** `setup.sh` is meant to be read and run
  once by a human, not by CI.
- **Building images on the VPS.** The VPS has no source code and never runs
  `docker build` — only CI builds, the VPS only pulls.
