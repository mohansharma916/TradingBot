# AI-Assisted F&O Trading Platform (Personal Workstation)

Universal personal trading workstation for Indian exchange-traded Futures and Options (F&O) via Upstox. Built with a shared React Native / Expo universal client (Android, iOS, and authenticated Web) and a high-performance NestJS modular monolith with dedicated worker runtime and PostgreSQL.

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
                   NSE / BSE markets
```

### Safety Principles & Invariants
1. **Model Output is NOT an Order Instruction**: Specialized AI agents only suggest trades by generating structured, typed `TradeProposal` records. AI models NEVER hold broker credentials and cannot place or modify orders directly.
2. **Deterministic Risk Gates**: Every order must pass pure mathematical risk rules (account capital hard cap ₹10,000, max all-in trade risk ₹500 including brokerage, taxes and slippage buffer, daily loss cap ₹1,500).
3. **Safe Defaults**: All systems initialize in `PAPER` simulation mode and `DISARMED` state.
4. **Kill Switch**: Prominent one-click emergency stop freezes all new submissions and sets orchestrator state to `EMERGENCY_STOP`.

---

## Monorepo Layout

```text
├── apps/
│   ├── trader/           # Expo Router universal application (Android, iOS, Web)
│   ├── api/              # NestJS HTTP REST & client WebSocket BFF server (Port 4000)
│   └── worker/           # Dedicated NestJS long-running trading runtime (Port 4001)
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

### 3. Run Database Migrations
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
pnpm run dev:worker  # Worker runtime with leader lock
pnpm run dev:trader  # Expo Web interface at http://localhost:8081
```

---

## Docker Compose Setup

Run PostgreSQL and backend services with Docker Compose:
```bash
cd infrastructure/docker
docker-compose up -d
```
