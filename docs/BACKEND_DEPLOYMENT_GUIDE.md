# Backend Automated Deployment Guide (EC2 / VPS)

This guide documents the automated CI/CD pipeline for deploying the backend services (NestJS API, Strategy Worker, PostgreSQL, and Caddy Reverse Proxy).

---

## 1. Architecture Overview

```
                        Git Push to `main`
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
       [AWS Amplify]                   [GitHub Actions]
       (Auto-deploys)                  (Auto-deploys)
               │                               │
               ▼                               ▼
      Static Web Client                1. Runs Quality Gates
     (React / Expo App)                   - Typecheck
      at yourdomain.com                   - Full Test Suite (371 tests)
                                          - Build Packages
                                               │ (if passes)
                                               ▼
                                       2. SSH Deploy to EC2 / VPS
                                          - Pulls latest code
                                          - Builds Docker containers
                                          - Zero-downtime container swap
                                          - Health-checks API
                                          - Prunes old images
```

---

## 2. One-Time Server Setup (EC2 or VPS)

### A. Launch an EC2 Instance or VPS
- **OS:** Ubuntu 22.04 LTS or 24.04 LTS (recommended: `t3.small` or `t3.medium` with at least 2GB RAM).
- **Security Group / Firewall Ports:**
  - `22` (SSH) — Restricted to your IP or GitHub Actions IPs
  - `80` (HTTP) — Open to anywhere (used by Caddy for Let's Encrypt SSL challenge)
  - `443` (HTTPS) — Open to anywhere (public API & WebSocket endpoint)

### B. Install Docker & Docker Compose
Connect to your server via SSH and run:
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin git

# Log out and log back in for docker group to take effect
exit
```

### C. Clone Repository and Configure Environment
Log back into your server:
```bash
# Clone the repository
git clone https://github.com/<YOUR_GITHUB_USER_OR_ORG>/TRADING-BOT.git ~/opt/fo-trading
cd ~/opt/fo-trading

# Configure your production environment file
cp .env.example .env.production
nano .env.production
```
Make sure `.env.production` has your production credentials:
- `JWT_SECRET` (generate a random 32+ character string)
- `OWNER_PASSWORD` (choose a secure password for the admin login)
- `TOKEN_ENCRYPTION_KEY` (generate a random 32+ character string)
- `DB_USER` and `DB_PASSWORD` (set your Postgres credentials)
- `UPSTOX_API_KEY` & `UPSTOX_API_SECRET`
- `UPSTOX_EGRESS_IP` (your EC2 Elastic IP)

### D. Update Caddy Domain
Edit `infrastructure/production/Caddyfile`:
```caddy
api.yourdomain.com {
    encode zstd gzip
    reverse_proxy api:3000
}
```
Point your domain's DNS A-record (`api.yourdomain.com`) to your EC2 instance's Elastic IP. Caddy automatically provisions and renews SSL certificates via Let's Encrypt.

---

## 3. Configure GitHub Secrets for Auto-Deployment

In your GitHub repository, navigate to:  
**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add the following 3 secrets:

| Secret Name | Value | Description |
| :--- | :--- | :--- |
| `SSH_HOST` | `13.xxx.xxx.xxx` or `api.yourdomain.com` | Your EC2 Public IP or DNS |
| `SSH_USER` | `ubuntu` | SSH login username (usually `ubuntu` or `ec2-user`) |
| `SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | Your private SSH key (contents of your `.pem` file) |
| `APP_DIR` | `~/opt/fo-trading` | *(Optional, default: `~/opt/fo-trading` or `/opt/fo-trading`)* |

---

## 4. How the Auto-Deployment Works

Whenever you push code to `main` (or trigger the **Deploy Backend (EC2/VPS)** workflow manually from the **Actions** tab):

1. **Validation Stage (`validate`):**
   - GitHub Actions checks out the code.
   - Installs dependencies and runs TypeScript typechecks.
   - Runs all 371 unit and integration tests.
   - If tests fail, the deployment is **aborted immediately**, keeping production safe.

2. **Deployment Stage (`deploy`):**
   - Connects to your EC2 instance via encrypted SSH.
   - Navigates to your app directory (`~/opt/fo-trading` or `/opt/fo-trading`).
   - Executes [`infrastructure/scripts/deploy.sh`](file:///Users/user/Documents/Projects/TRADING-BOT/infrastructure/scripts/deploy.sh).
   - Fetches and resets to the latest commit on `main`.
   - Runs `docker compose -f infrastructure/production/docker-compose.yml up -d --build --remove-orphans`.
   - Verifies the NestJS API health check at `http://127.0.0.1:3000/api/v1/strategies`.
   - Cleans up dangling Docker images to keep your server disk clean.

---

## 5. Manual Deployment & Monitoring on the Server

You can also trigger a deployment manually on the server at any time:
```bash
cd ~/opt/fo-trading   # or cd /opt/fo-trading
./infrastructure/scripts/deploy.sh
```

To view live container logs:
```bash
# View all logs
docker compose -f infrastructure/production/docker-compose.yml logs -f

# View only API logs
docker compose -f infrastructure/production/docker-compose.yml logs -f api

# View background worker logs
docker compose -f infrastructure/production/docker-compose.yml logs -f worker
```
