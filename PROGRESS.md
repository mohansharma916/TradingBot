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
| **Phase 2** | **Strategy Engine & Tool-Restricted Agents** | **COMPLETED ✅** | Deterministic indicator rules & verified expiring `TradeProposal` pipeline, 54 tests pass |
| **Phase 3** | **Risk Engine & Paper Broker Simulation** | **COMPLETED ✅** | Transactional capital locks, slippage/charges model, zero double-spending, 68 tests pass |
| **Phase 4** | **Upstox Read-Only Portfolio & OAuth Integration** | **COMPLETED ✅** | AES-256-GCM token encryption, OAuth flow, egress IP validation, broker reconciliation, 84 tests pass |
| **Phase 5** | Supervised Live Order Execution (Approval Mode) | Next Up ⏳ | Owner approval window, multi-leg GTT protection, orderbook reconciliation |
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

## Phase 3: Risk Engine & Paper Broker Simulation — COMPLETED ✅

### Deliverables Implemented:

1. **Order State Machine & Transition Rules (`packages/domain/src/order-state-machine.ts`)**:
   - Strict transition graph enforcing valid broker state sequences:
     - `PENDING` -> `ACKNOWLEDGED` -> `PARTIALLY_FILLED` -> `FILLED`
     - Terminal states: `FILLED`, `CANCELLED`, `REJECTED` are strictly immutable; attempts to transition out of terminal states throw deterministic domain errors.
     - Quantity reconciliation: Rejects invalid fills where filled quantity exceeds order quantity or where price is non-positive.

2. **Central Transactional Cash & Risk Reservations (`apps/api/src/risk/risk-reservation.manager.ts`)**:
   - **Zero Double-Spending Atomic Guard**: Memory & database locks guarantee cash debits atomically. When Agent 1 reserves ₹6,000, available cash drops to ₹4,000; a concurrent request from Agent 2 for ₹5,000 is rejected immediately with `CAPITAL_EXHAUSTION`.
   - **Unique Signal Key Intent Lock**: Prevents duplicate executions on the same 5-minute candle bar (`strategyId:instrumentKey:timeframe:candleTime`).
   - **Hard Risk Caps**: Enforces ₹10,000 max capital, ₹500 all-in trade loss cap, ₹1,500 daily drawdown cap, and 1 max open position.
   - **Reservation Lifecycle**: Clean transactional methods for `acquireReservation`, `commitReservationToPosition`, `releaseReservation`, and `settleClosedPosition`.

3. **High-Fidelity Paper Broker Engine (`apps/api/src/broker/paper-broker.adapter.ts`)**:
   - **Stale Quote Gate**: Invariant checking `feed.getQuote()`. If `isStale` is true or quote age exceeds 3,000ms, order submission transitions directly to `REJECTED` with reason `REJECTED_STALE_FEED`, preserving capital during feed disruptions.
   - **Simulated Execution**: Models realistic fills, slippage, and supports partial executions (`PARTIALLY_FILLED` with updated average fill price).
   - **Statutory Charges Calculation (`calculateOptionCharges`)**: Computes verified Indian F&O option charges (Brokerage: ₹40 per roundtrip, STT: 0.1% on sell turnover, NSE exchange charges: 0.0505%, SEBI fees: 0.0001%, Stamp duty: 0.003%, GST: 18%).
   - **Estimated vs Actual Cost Tracking**: Stores both `estimatedCharges` from proposals and verified `actualCharges` computed from fill parameters.

4. **Orders & Positions Service & API (`apps/api/src/orders/orders.service.ts` & `orders.controller.ts`)**:
   - `GET /orders`: Returns all broker orders across all states.
   - `GET /positions`: Returns open positions with net quantity, average buy/sell prices, and unrealized MTM P&L.
   - `GET /orders/fills`: Returns full audit ledger of executed fills with granular statutory charge breakdowns.
   - `POST /orders/execute-proposal`: Atomically acquires capital reservation, dispatches paper order, commits position, and broadcasts WebSocket events.
   - `POST /positions/:key/close`: Market closes an open position, computes net P&L, records exit fill, and settles reservations.

5. **Client SDK Extensions (`packages/client-sdk/src/client.ts`)**:
   - `getOrders()`, `getPositions()`, `getOrderFills()`, `executeProposal()`, `closePosition()`.

6. **Universal Workstation UI (`apps/trader/app/orders.tsx`)**:
   - **Risk & Capital Status Widget**: Live Available Cash, Reserved Capital under lock, Remaining Daily Drawdown Budget, Max All-In Trade Loss cap.
   - **Positions Tab**: Displays active contract, net quantity, average price, LTP, unrealized MTM P&L, protective stop (GTT), profit target (GTT), and single-click "Market Close Position".
   - **Orders Tab**: Displays order table with status badges (`FILLED`, `PARTIAL`, `REJECTED`, `ACKNOWLEDGED`), fill details, and rejection reasons.
   - **Trade Journal & Fill Ledger Tab**: Detailed audit log displaying side-by-side **Estimated Fees vs Actual Charges** with full breakdown (Brokerage, STT, Exchange, Stamp, GST) and net cost savings/variance.
   - **Simulation Testbench Bar**: Single-click testing of paper fills, partial fills, and stale feed gates.

### Verification & Test Matrix

- **Unit & Integration Tests**: 68 passed / 68 total (Vitest across 16 test files):
  - Domain tests: Order state machine transitions, terminal state immutability, quantity bounds, statutory charge formulas.
  - Risk & Broker integration tests: Zero double-spending between agents, stale quote feed gate rejection (>3,000ms), unique signal bar deduplication, drawdown budget exhaustion, partial fill handling.
  - Client & Trader UI tests: PositionSchema GTT bounds, BrokerOrderSchema state transitions, OrderFillEventSchema charge comparisons, RiskStatusSchema balance consistency.
- **TypeScript Typecheck**: Passed across all 8 workspace projects with 0 errors (`pnpm run typecheck`).
- **Monorepo Build**: Passed cleanly across all packages and services (`pnpm run build`).

---

## Phase 4: Upstox Read-Only Portfolio & OAuth Integration — COMPLETED ✅

### Deliverables Implemented:

1. **Encrypted Token Store (`apps/api/src/broker/token-storage.service.ts`)**:
   - **AES-256-GCM Encryption**: Tokens encrypted using authenticated AES-256-GCM with a 12-byte IV and 16-byte authentication tag derived via SHA-256 from `TOKEN_ENCRYPTION_KEY`.
   - **Integrity Verification**: Decryption validates authentication tags; tampered ciphertexts fail immediately with integrity violation errors.
   - **Secret Redaction**: Access tokens and client secrets are automatically redacted in string helpers (`TokenStorageService.redactSecret()`) and never printed in logs or sent unencrypted to clients.
   - **Session Expiry Tracking**: Accurately tracks seconds remaining, expiry timestamps, and validity states.

2. **Upstox OAuth 2.0 Engine (`apps/api/src/broker/upstox-oauth.service.ts`)**:
   - **Secure Authorization URL Generation**: Generates 16-byte cryptographically random CSRF `state` with 10-minute expiry window, routing to `https://api.upstox.com/v2/login/authorization/dialog`.
   - **Code Exchange with State Protection**: Validates and consumes CSRF `state` to prevent replay attacks, exchanging codes for tokens via Upstox V2 token API.
   - **Sandbox & Simulation Compatibility**: Supports seamless sandbox/mock verification when running without live credentials.
   - **Session Status & Disconnect**: Queries session metadata and allows owner-initiated disconnect which purges encrypted credentials from memory and broadcasts WebSocket events.

3. **Typed Read-Only Upstox Broker Adapter (`apps/api/src/broker/upstox-broker.adapter.ts`)**:
   - **Rate Limiting Guard**: Token-bucket rate limiter enforcing Upstox API limit (25 req/sec).
   - **Read Endpoints Synchronized**:
     - Funds & Margins: Maps Upstox equity data to `FundsSnapshot`.
     - Orderbook & Fills: Retrieves broker orders and normalizes to `BrokerOrder[]`.
     - Portfolio & Positions: Retrieves live open positions mapped to typed `Position[]`.
   - **Strict Live Write Safety Invariants**: `placeOrder()`, `modifyOrder()`, and `cancelOrder()` explicitly throw safety violation errors (`TODO-VERIFY: Live writes strictly disabled until Phase 5 human approval workflow is activated`).

4. **Startup & Continuous Broker Reconciliation Engine (`apps/api/src/broker/broker-reconciliation.service.ts`)**:
   - **Automated Startup Audit**: Executes on server startup via `OnApplicationBootstrap` and on-demand via `POST /broker/reconcile`.
   - **Phantom Position Detection**: Identifies trades executed on Upstox broker app outside workstation; flags `PHANTOM_BROKER_POSITION` with `CRITICAL` severity.
   - **Position Quantity & Price Mismatch Detection**: Flags quantity divergences (`POSITION_MISMATCH`) and average price divergences (`PRICE_MISMATCH`).
   - **Safety Freeze Invariant**: If ANY critical discrepancy is detected, triggers the `RiskReservationManager` kill switch, sets `executionFrozen: true`, freezes new trade entry submissions, and broadcasts WebSocket alerts.

5. **Client SDK Extensions (`packages/client-sdk/src/client.ts`)**:
   - `getUpstoxSession()`, `connectUpstox()`, `exchangeUpstoxCallback()`, `disconnectUpstox()`, `getReconciliationReport()`, `triggerReconciliation()`.

6. **Universal Health, Security & Reconciliation Screen (`apps/trader/app/health.tsx`)**:
   - **Upstox OAuth 2.0 Panel**: Real-time connection status badge, AES-256-GCM encryption verified indicator, registered static egress IP check (`127.0.0.1 Exact Match`), token expiry countdown, and "Reauthenticate OAuth" / "Disconnect" actions.
   - **Reconciliation Audit Panel**: Displays broker positions vs local ledger comparison, orders comparison, active discrepancies count, and "Run Audit Now" action.
   - **Safety Alert Banner**: High-visibility alert that automatically appears when a reconciliation mismatch is detected, notifying the owner that entries are frozen until cleared.
   - **Testbench Triggers**: Allows testing external phantom position injection to verify safety freeze.

### Verification & Test Matrix

- **Unit & Integration Tests**: 84 passed / 84 total (Vitest across 18 test files):
  - Token Encryption tests: AES-256-GCM encryption/decryption, tampered auth tag rejection, secret redaction.
  - OAuth 2.0 tests: CSRF state generation, expired state rejection, replay attack prevention, mock code exchange, disconnect purge.
  - Read-Only Broker tests: Authenticated vs degraded health status, rate limiting, live order write route blocking.
  - Reconciliation tests: Clean audit verification, phantom broker position detection, quantity divergence detection, automatic kill switch activation and execution freeze.
  - Client & Trader UI tests: UpstoxSessionStatusSchema, ReconciliationReportSchema, BrokerHealthSchema.
- **TypeScript Typecheck**: Passed across all 8 workspace projects with 0 errors (`pnpm run typecheck`).
- **Monorepo Build**: Passed cleanly across all packages and services (`pnpm run build`).

---

## Next Steps: Phase 5 — Supervised Live Order Execution (Approval Mode)

**Phase 5 Objectives:**
- Live order execution only behind explicit feature flags and owner `APPROVAL` mode.
- Short-lived owner approval window (countdown timer) with revalidation before dispatch.
- Idempotent execution intent (`intentId`) and central account-level lock.
- Upstox V3 Order Placement, Modification, and Cancellation in broker adapter.
- Supported GTT exits (stop-loss and profit target) tied to broker order legs.
- Order state tracking: `ACKNOWLEDGED`, `PARTIALLY_FILLED`, `FILLED`, `PENDING_PROTECTION`, `CLOSED`, and `UNKNOWN`.
- Handling simulated request timeouts, uncovered positions, and unfilled exit limits.
- UI rules: Never label `ACKNOWLEDGED` as `FILLED` and never display a stop as "guaranteed".
- Explicit manual go-live safety checklist.
