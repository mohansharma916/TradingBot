# AI F&O Trading Platform — Implementation Progress & Audit Log

**Target Platforms:** Android, iOS, Authenticated Web (Expo Universal)  
**Backend:** NestJS Modular Monolith + Dedicated PostgreSQL Worker Runtime  
**Broker:** Upstox (Isolated behind typed `BrokerPort` abstraction)  
**Safety Mandate:** Default `PAPER` mode, default `DISARMED`, strictly deterministic risk gates.

---

## Roadmap Overview & Phase Status

| Phase | Description | Status | Exit Gate |
|---|---|---|---|
| **Phase 0** | **Repository Foundations & Monorepo Shell** | **COMPLETED ✅** | All target packages build, backend & worker start, 21 tests pass |
| **Phase 1** | **Instruments & Streaming Market Data Feed V3** | **COMPLETED ✅** | Protobuf V3 decoder, catalog indexing, stale feed detection, 34 tests pass |
| **Phase 2** | Strategy Engine & Tool-Restricted Agents | Next Up ⏳ | Deterministic indicator rules & verified expiring `TradeProposal` pipeline |
| **Phase 3** | Risk Engine & Paper Broker Simulation | Pending | Transactional capital locks, slippage/charges model, zero double-spending |
| **Phase 4** | Upstox Read-Only Portfolio & OAuth Integration | Pending | Token encryption, broker account reconciliation, egress IP validation |
| **Phase 5** | Supervised Live Order Execution (Approval Mode) | Pending | Owner approval window, multi-leg GTT protection, orderbook reconciliation |
| **Phase 6** | Operational Resilience, Diagnostics & Mobile Polish | Pending | Kill switch, flatten position command, alert notifications, incident drills |
| **Phase 7** | Bounded Autonomous Execution (Armed Auto Mode) | Gated | Regulatory checklist passed, multi-day paper proof, hard limits locked |

---

## Phase 1: Instruments & Streaming Market Data Feed V3 — COMPLETED ✅

### Deliverables Implemented:
1. **Upstox Market Data Feed V3 Protobuf Decoding**:
   - `apps/api/src/market-data/proto/MarketDataFeed.proto`: Official protocol buffers schema defining `FeedResponse`, `FullFeed`, `LTPC`, `MarketLevel`, and `MarketOHLC`.
   - `apps/api/src/market-data/protobuf-decoder.service.ts`: Protobuf decoding and encoding service that converts binary Upstox WebSocket payloads into typed, normalized `QuoteSnapshot` and 5-level `MarketDepth` structures.
2. **Instrument Catalog & Search Service**:
   - `apps/api/src/instruments/instrument-catalog.service.ts`: Indexes 160+ active F&O instruments and spot indexes for NIFTY and BANKNIFTY with correct lot sizes (25 for NIFTY, 15 for BANKNIFTY) and weekly/monthly expiries.
   - `apps/api/src/instruments/instruments.controller.ts`: REST endpoints for searching contracts (`/instruments/search`), fetching expiries (`/instruments/expiries/:underlying`), and querying individual tokens (`/instruments/:key`).
   - `OptionChainResult` builder: Organizes strikes into aligned pairs with Call & Put quotes, volumes, open interest, and bid/ask depth.
3. **Resilient Market Feed & Telemetry (`UpstoxMarketFeedService`)**:
   - Server-side WebSocket connection to `wss://api.upstox.com/v3/feed/market-data-feed`.
   - **Duplicate Tick Filtering**: Monotonic timestamp checks ignore identical or out-of-order ticks.
   - **Quote Gap Logging**: Automatically flags jumps exceeding 15 seconds during continuous market hours.
   - **Stale Feed Detector**: Evaluates tick freshness against a 3,000ms threshold during open market sessions; automatically marks quotes `isStale: true` and broadcasts `feed.stale` to freeze new entries.
   - **Reconnection with Backoff & Jitter**: Reconnects on unexpected disconnects with exponential backoff (1s to 30s) and ±20% randomized jitter.
   - **Expired Token Isolation**: Accurately traps HTTP 401 and code 4401 auth failures, sets `AUTH_FAILED` status, and suppresses retry loops to prevent hammering Upstox.
4. **Market Calendar & Timings**:
   - `packages/domain/src/market-calendar.ts`: Evaluates Indian Standard Time (IST - UTC+05:30), trading sessions (`PRE_OPEN`, `REGULAR_SESSION`, `POST_CLOSE`, `MARKET_CLOSED`, `WEEKEND`), and checks against the official 2026 NSE/BSE holiday calendar.
5. **Broker Port & Read-Only Adapters**:
   - `apps/api/src/broker/broker.port.ts`: Strongly typed `BrokerPort` interface.
   - `apps/api/src/broker/paper-broker.adapter.ts`: Simulation adapter with realistic fixtures.
   - `apps/api/src/broker/upstox-broker.adapter.ts`: Official Upstox V3 read-only adapter with explicit safety blocks on live order modifications (`TODO-VERIFY: Live order execution blocked until Phase 5`).
6. **Universal Workstation UI Updates (`apps/trader/app/markets.tsx`)**:
   - Dense interactive Option Chain ladder with strike selector, ATM pill, ITM shading, and call/put LTP, change %, bid/ask, and open interest.
   - Live Watchlist cards with real-time spot updates for NIFTY 50 and BANK NIFTY.
   - Prominent Stale Feed visual warning banner that appears if stream latency spikes.
   - Interactive F&O Instrument Search modal.

### Verification & Test Matrix

- **Unit & Integration Tests**: 34 passed / 34 total (Vitest).
- **TypeScript Typecheck**: Passed across all 8 workspace projects with 0 errors.
- **Monorepo Build**: Passed across all packages and services (`tsc`).
- **Live REST Endpoint Probes**:
  - `GET /api/v1/markets/calendar` -> `{"session":"WEEKEND","isOpen":false,"currentTimeIst":"... IST"}`
  - `GET /api/v1/markets/feed-health` -> `{"status":"...","feedLatencyMs":15,"activeSubscriptions":5}`
  - `GET /api/v1/instruments/search?query=25100&limit=2` -> Returns matching NIFTY 25100 CE and PE contracts with lot size 25.
  - `GET /api/v1/markets/options-chain?underlying=NIFTY` -> Returns strike ladder from 24800 to 25400 with Call and Put pairs.
  - `POST /api/v1/markets/subscribe` -> `{"success":true,"subscribedCount":1}`

---

## Phase 2: Agent Workspace & Deterministic Strategies (Completed)

**Implemented Deliverables:**

1. **Contracts & Strict Schemas (`packages/contracts`)**:
   - `StrategyConfigSchema` and sub-schemas (`StrategySessionSchema`, `StrategyEntryRuleSchema`, `StrategySelectionSchema`, `StrategyRiskRulesSchema`, `StrategyExitRulesSchema`).
   - Hard account caps strictly enforced in schema: `maxCapitalInr <= 10,000`, `maxAllInTradeLossInr <= 500`, `maxAllInDailyLossInr <= 1,500`.
   - Read-only agent tool schemas: `scan_universe`, `calculate_indicators`, `evaluate_strategy`, `draft_trade_proposal`.
   - `AgentToolName` enum restricting agent tool execution. Write/order actions strictly prohibited.
   - `AgentTaskSchema` capturing complete audit logs of tools invoked, timestamps, inputs, outputs, and proposal links.

2. **Deterministic Domain Rules Engine (`packages/domain`)**:
   - `candle-manager.ts`: 5-minute candle aggregation from ticks, confirmed candle-close event trigger, intra-bar flickering prevention (forming candles isolated), and out-of-order tick rejection to prevent look-ahead bias.
   - `indicators.ts`: `validateWarmup()` helper ensuring indicators (EMA-20, RSI-14) require at least 20 closed bars before generating signals.
   - `strategy-evaluator.ts`: Evaluates entry rules strictly on closed bars (EMA cross above, RSI momentum >= 55, Bid/Ask spread <= 1.0%, contract volume >= 1,000, session time window). Generates expiring `TradeProposal` with sizing, roundtrip fees, slippage buffer, and risk cap checks.
   - `strategy-version.ts`: Recursive canonical FNV-1a SHA-256 hash generator and automatic version bump detection (`requiresVersionBump()`).

3. **Backend Multi-Agent Subsystem & Strategy Service (`apps/api`)**:
   - `agent-tools.service.ts`: Tool execution router with hard security gate (`AgentSecurityViolationError`) rejecting any broker mutation attempts.
   - `market-scanner.agent.ts`: Scans F&O universe, calculates live spread %, and ranks candidate contracts.
   - `strategy-analyst.agent.ts`: Evaluates closed bars, computes indicators, and produces expiring `TradeProposal`.
   - `agent-coordinator.service.ts`: Coordinates multi-agent tasks, logs execution history, and broadcasts real-time WebSocket events.
   - `strategies.service.ts` & `strategies.controller.ts`: Versioned strategy CRUD with automatic version incrementing on parameter modifications.
   - `proposals.service.ts` & `proposals.controller.ts`: Manages trade proposals, handles 3-minute TTL expiration, and supports owner authorization/rejection.

4. **Universal Client Workstation (`apps/trader`)**:
   - `app/strategies.tsx`: Interactive Strategy Workspace & Builder with rule editing modal, real-time risk checks, "Trigger Agent Scan" button, and immutable version audit ledger.
   - `app/proposals.tsx`: Proposals Inspector with live countdown timer (`Expires in MM:SS`), objective agent evidence breakdown (EMA, RSI, VWAP, Spread %, Volume), authorize/reject actions, and dedicated "Agent Task Board" tab with tool invocation audit trails.

### Verification & Test Matrix

- **Unit & Integration Tests**: 54 passed / 54 total (Vitest across 13 test files).
  - Domain tests: Warm-up verification, candle-close semantics (no intra-bar signal), look-ahead bias rejection, spread & volume filters, deterministic version hashing.
  - Contracts tests: Hard risk caps rejection, read-only tool boundaries, prohibited write tool rejection.
  - API tests: Agent tool security bounds, multi-agent scan execution, proposal lifecycle and expiration.
  - Trader client tests: Strategy version hashing and proposal inspector contracts.
- **TypeScript Typecheck**: Passed across all 8 workspace projects with 0 errors (`pnpm run typecheck`).
- **Monorepo Build**: Passed across all packages and services (`pnpm run build`).

---

## Next Steps: Phase 3 — Risk Engine & Paper Broker

**Phase 3 Objectives:**
- Pure deterministic account-wide `RiskPolicy` evaluation: budget, per-trade all-in risk, daily drawdown, open positions, trade count, slippage buffer, fees estimate, margin, lot-size and liquidity limits.
- Central transactional cash/risk reservations and unique signal intent (`signalKey`).
- Paper broker adapter with simulated fills, slippage, partial fills, and order state machine.
- Position ledger and trades/orders journal screens in the universal app.
- Proof that two agents cannot double-spend capital, stale quotes block orders, and all P&L has correct estimated-vs-actual cost labels.
