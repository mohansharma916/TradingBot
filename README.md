# AI-Assisted F&O Trading Platform (Personal Workstation)

Personal workstation for long Indian index-option trading via Upstox. Built with a shared React Native / Expo client and a NestJS modular monolith with a passive API observer. Trading state is persisted in the API state directory; PostgreSQL schema files are optional infrastructure and are not the active trading ledger.

---

## Architecture Overview

```text
       EXPO UNIVERSAL APP (WEB + ANDROID + IOS)
   Strategy UI | Agent Tasks | Approvals | P&L | Alerts
                         |
                 HTTPS + WebSocket
                         |
           NESTJS API / AUTH / BFF LAYER
                         |
       +-----------------+------------------+
       |                 |                  |
 Strategy Engine    Agent Coordinator    Portfolio API
 (deterministic)    (restricted tools)   + Reporting
       |                 |
       +----- TradeProposal / Signal ------+
                         |
                RISK + POLICY ENGINE
          (single serialized account gate)
                         |
                 ORDER ORCHESTRATOR
              (durable state machine)
                         |
             BROKER ADAPTER / UPSTOX
        OAuth | Market V3 | Orders | GTT | Funds
                         |
                   NSE index options
```

### Safety Principles & Invariants
1. **Analysis does not submit orders**: The current analysis agents use deterministic strategy rules to generate typed `TradeProposal` records. Broker credentials and dispatch belong to the authenticated execution services; analysis output must pass owner approval and risk gates.
2. **Deterministic Risk Gates**: Entries must pass configured capital and loss limits (defaults: ₹10,000 account budget, ₹500 all-in trade risk including estimated charges and slippage, ₹1,500 daily loss cap).
3. **Safe Defaults**: Fresh installations start in Testing (`PAPER`). The selected mode persists; every restart starts disarmed.
4. **Kill Switch**: Prominent one-click emergency stop freezes all new submissions and sets orchestrator state to `EMERGENCY_STOP`.

---

## Monorepo Layout

```text
├── apps/
│   ├── trader/           # Expo Router universal application (Android, iOS, Web)
│   ├── api/              # NestJS HTTP REST & client WebSocket BFF server (Port 4000)
│   └── worker/           # Passive observer of authenticated API risk state
├── packages/
│   ├── contracts/        # Shared Zod schemas, DTOs, system enums, and API types
│   ├── domain/           # Pure financial formulas, Indian F&O charges, lot sizes, indicators
│   ├── ui/               # Institutional dark theme design tokens & cross-platform primitives
│   ├── client-sdk/       # Typed API client for universal frontend
│   └── config/           # Shared TypeScript and ESLint configurations
├── infrastructure/
│   ├── docker/           # Multi-stage Dockerfiles and docker-compose.yml
│   ├── nginx/            # Reverse proxy configuration
│   └── scripts/          # PostgreSQL DDL migrations and migration runner
├── docs/                 # Blueprint, ADRs, runbooks
└── .github/workflows/    # Continuous Integration pipeline
```

---

## Quickstart & Development

### Prerequisites
- Node.js `v22+` or `v24+`
- pnpm `v10+`
- Docker (optional, for local PostgreSQL)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Set `OWNER_PASSWORD` to a private password with at least 12 characters. Set private `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` values. Sign in as `owner` (or your configured `OWNER_USERNAME`). Real broker tokens are encrypted in `STATE_DIRECTORY`. Keep that directory persistent and private.

`STATE_DIRECTORY` is resolved from the API process's working directory. An absolute path avoids loading a different ledger when changing launch commands or deployment directories.

### 3. Optional Database Migrations
```bash
pnpm run db:migrate
```

### 4. Run Tests & Validation
```bash
pnpm run test
pnpm run typecheck
```

### 5. Start Development Servers
```bash
# Start API, Worker, and Trader Web concurrently
pnpm run dev

# Or start individually:
pnpm run dev:api     # http://localhost:4000/api/v1
pnpm run dev:worker  # Passive API observer
pnpm run dev:trader  # Expo Web interface at http://localhost:8081
```

---

## Docker Compose Setup

Run PostgreSQL and backend services with Docker Compose:
```bash
cd infrastructure/docker
docker-compose up -d
```


## Testing and Live

The top navbar selects **Testing** or **Live**. Testing uses virtual cash, a separate durable paper ledger, simulated fills and modeled charges. Its initial cash is `MAX_ACCOUNT_CAPITAL_INR`; funds and P&L subsequently follow its actual simulated fills. Connect Upstox for genuine instrument metadata, real quotes and closed historical bars; unavailable or stale data blocks entries rather than inventing quotes.

For Live, configure your genuine Upstox app credentials, redirect URL, applicable broker settings and private token encryption key; connect using OAuth and set `LIVE_EXECUTION_ENABLED=true` on the server. The selector verifies Upstox V3 net cash, used margin and existing orders/positions before changing mode. Option buys use `cash_available_to_trade.total`; pledged collateral is excluded from spendable cash. The configured personal capital and loss limits remain enforced even when the broker balance is larger. Existing exposure, pending orders or an active Daily Bot block switching.

If your Upstox app requires an exchange-approved algo name, set `UPSTOX_ALGO_NAME` to the exact configured name; the API forwards it in `X-Algo-Name`. Owner checklist evidence must reflect the actual account settings.

Selecting Live does not place an order. Review the recorded go-live evidence, arm the account for a bounded window, start a mode-matching Daily Bot session with explicit consent and approve its current proposal. Execution uses Upstox broker IDs and confirmed fills. ACK, partial fill, rejected and unknown outcomes remain distinct. Positions close only after complete exit fills and verified flat broker exposure. A broker SELL GTT stop protects confirmed positions; target and tighter trailing exits are monitored by the API process. Keep that process running and supervise it.

Run one API per account and shared state directory. It holds an exclusive file lock before state recovery. After an unclean crash, verify the old API process has stopped before removing `account-runtime.lock`. Use the same state directory after restart; unresolved live exposure remains frozen for reconciliation and fresh owner arming is required. This is a personal single-process installation, not a distributed multi-server execution system.

Use that state directory with one Upstox account. Changing broker accounts while exposure is unresolved requires reconnecting the original account and reconciling it first; deleting its ledger does not resolve that exposure. Broker responses from a replaced login session are rejected, and uncertain mutation outcomes stay frozen.

The verified exchange holiday calendar currently covers **2026**. New entries in other years are blocked until verified exchange dates are added. Existing position monitoring and exit protection continue independently of entry-calendar availability.

Backtests use named historical underlying providers and disclosed modeled option premiums. They are research estimates, not actual historical option fills or evidence of profit. Live charges are estimated until a broker contract note confirms them. No automated test places real orders or proves live profitability.
