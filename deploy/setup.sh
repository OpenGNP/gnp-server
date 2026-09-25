#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu/Debian VPS that will run gnp-server and
# gnp-client as Docker containers, deployed by GitHub Actions over SSH.
#
# Run this as root (or with sudo) on the VPS itself — it is NOT meant to be
# run by CI, and it does NOT build any images (CI does that and pushes to
# GHCR; the VPS only ever pulls). Read it through before running; a few steps
# need values filled in (.env secrets, the deploy user's SSH public key, a
# GHCR login).
#
# Usage: sudo bash setup.sh

set -euo pipefail

DEPLOY_USER="deploy"

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
apt-get install -y docker-compose-plugin

echo "==> Creating ${DEPLOY_USER} user"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"

echo "==> Preparing /opt/gnp"
mkdir -p /opt/gnp
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" /opt/gnp

cat <<'EOF'

==> MANUAL STEP: copy docker-compose.yml to the VPS

    From your machine (not the VPS), with this repo checked out:
      scp deploy/docker-compose.yml deploy@<vps-ip>:/opt/gnp/docker-compose.yml

EOF

cat <<'EOF'

==> MANUAL STEP: create /opt/gnp/.env
    (as the deploy user — this is gnp-server's runtime env, loaded via
    docker-compose.yml's env_file; never committed, never touched by CI)

    sudo -u deploy tee /opt/gnp/.env <<'ENV'
    PORT=3000
    NODE_ENV=production
    JWT_SECRET=<generate a real secret>
    CLIENT_URL=http://<vps-ip>
    DATABASE_URL=postgres://user:password@<kmutt-db-host>:5432/opengnp_db
    MINIO_ENDPOINT=<...>
    MINIO_PORT=<...>
    MINIO_USE_SSL=<...>
    MINIO_ACCESS_KEY=<...>
    MINIO_SECRET_KEY=<...>
    MINIO_BUCKET=gnp-uploads
    ENV

    This VPS must already be able to reach the KMUTT DB/MinIO host (VPN client
    configured and connected) before gnp-server will start successfully.

EOF

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw --force enable

cat <<'EOF'

==> MANUAL STEP: log in to GHCR so the VPS can pull private images

    On GitHub: Settings -> Developer settings -> Personal access tokens ->
    generate a classic token with the `read:packages` scope.

    On the VPS, as the deploy user:
      docker login ghcr.io -u <your-github-username>
      (paste the token as the password)

    This only needs to be done once — the login persists in
    /home/deploy/.docker/config.json.

==> MANUAL STEP: SSH key for GitHub Actions

    On your machine (not the VPS):
      ssh-keygen -t ed25519 -C "gnp-deploy" -f gnp_deploy_key -N ""

    Append gnp_deploy_key.pub to /home/deploy/.ssh/authorized_keys on the VPS.

    In BOTH GitHub repos (gnp-server, gnp-client) -> Settings -> Secrets and
    variables -> Actions, add:
      SSH_HOST          the VPS IP
      SSH_USER          deploy
      SSH_PRIVATE_KEY   contents of gnp_deploy_key (the private half)
      SSH_PORT          22 (optional, only needed if you use a non-default port)

    Delete the local private key file afterwards, or keep it somewhere safe —
    it grants deploy access to this box.

==> Then start both containers for the first time:
      cd /opt/gnp
      docker compose pull
      docker compose up -d
      docker compose ps
      curl http://127.0.0.1:3000/api/health

EOF
