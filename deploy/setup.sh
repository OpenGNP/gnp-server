#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu/Debian VPS that will host both gnp-server
# and the built gnp-client, deployed by GitHub Actions over SSH.
#
# Run this as root (or with sudo) on the VPS itself — it is NOT meant to be
# run by CI. Read it through before running; a few steps need values filled
# in (repo URLs if private, the deploy user's SSH public key, .env secrets).
#
# Usage: sudo bash setup.sh

set -euo pipefail

DEPLOY_USER="deploy"
SERVER_REPO="git@github.com:OpenGNP/gnp-server.git"   # use HTTPS + a PAT instead if the repo is private and you'd rather not manage a deploy key
CLIENT_REPO="git@github.com:OpenGNP/gnp-client.git"

echo "==> Installing packages"
apt-get update
apt-get install -y curl git nginx ufw unzip

echo "==> Creating ${DEPLOY_USER} user"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi

echo "==> Installing bun as ${DEPLOY_USER}"
sudo -u "${DEPLOY_USER}" bash -c 'curl -fsSL https://bun.sh/install | bash'

echo "==> Preparing /opt directories"
mkdir -p /opt/gnp-server /opt/gnp-client
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" /opt/gnp-server /opt/gnp-client

echo "==> Cloning repos as ${DEPLOY_USER} (skip if you'll do this manually, e.g. for a private repo over HTTPS+PAT)"
sudo -u "${DEPLOY_USER}" bash -c "
  [ -d /opt/gnp-server/.git ] || git clone ${SERVER_REPO} /opt/gnp-server
  [ -d /opt/gnp-client/.git ] || git clone ${CLIENT_REPO} /opt/gnp-client
"

cat <<'EOF'

==> MANUAL STEP: create /opt/gnp-server/.env
    (as the deploy user — it is gitignored and never touched by CI)

    sudo -u deploy tee /opt/gnp-server/.env <<'ENV'
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

echo "==> Installing systemd unit"
install -m 644 /opt/gnp-server/deploy/gnp-server.service /etc/systemd/system/gnp-server.service
systemctl daemon-reload
systemctl enable gnp-server

echo "==> Installing nginx site"
install -m 644 /opt/gnp-server/deploy/nginx.conf /etc/nginx/sites-available/gnp
ln -sf /etc/nginx/sites-available/gnp /etc/nginx/sites-enabled/gnp
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Allowing deploy user to restart gnp-server without a password"
cat > /etc/sudoers.d/gnp-deploy <<EOF
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart gnp-server, /usr/bin/systemctl status gnp-server
EOF
chmod 440 /etc/sudoers.d/gnp-deploy

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw --force enable

cat <<'EOF'

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

==> Then start the server for the first time:
      sudo systemctl start gnp-server
      sudo systemctl status gnp-server
      curl http://127.0.0.1:3000/api/health

EOF
