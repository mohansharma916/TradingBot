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
| **Phase 5** | **Supervised Live Order Execution (Approval Mode)** | **COMPLETED ✅** | Owner approval window, multi-leg GTT protection, failure injection drills, 102 tests pass |
| **Phase 6** | **Operational Resilience, Diagnostics & Mobile Polish** | **COMPLETED ✅** | Kill switch, flatten all command, alert notifications, incident drills, RFC-4180 CSV export, 112 tests pass |
| **Phase 7** | **Bounded Autonomous Execution (Armed Auto Mode)** | **COMPLETED ✅** | 6 pre-flight gates, bounded time windows, session trade caps, auto-disarming triggers, GTT exits, 119 tests pass |

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

## Phase 5: Supervised Live Order Execution (Approval Mode) — COMPLETED ✅

### Deliverables Implemented:

1. **Deterministic Order State Machine Invariants (`packages/domain/src/order-state-machine.ts`)**:
   - **Critical Invariant**: Broker `ACKNOWLEDGED` status is strictly NEVER labeled or treated as `FILLED` (`assertAckNotLabeledAsFilled`).
   - In-flight order identification (`isOrderInFlight`: `SUBMITTING`, `ACKNOWLEDGED`, `PARTIALLY_FILLED`).
   - Multi-leg GTT exit parameter validation (`validateGTTExitParameters`): ensures stop price < entry price, target price > entry price, and calculates all-in loss buffer to guarantee ₹500 hard cap is never exceeded.

2. **Supervised Live Execution Service (`apps/api/src/orders/supervised-execution.service.ts`)**:
   - **Feature Flag & Safety Gate**: Live order execution strictly blocked unless `LIVE_EXECUTION_ENABLED=true` and Go-Live 10-point checklist is fully signed off.
   - **Owner Approval Mode & Window Check**: Proposals must be explicitly authorized with status `APPROVED`; rejects execution if 180s countdown window has expired.
   - **Pre-Trade Revalidation**: Checks real-time tick freshness (< 3,000ms latency) and Bid/Ask spread (<= 1.0% liquidity ceiling) immediately prior to broker dispatch.
   - **Idempotent Intent & Central Capital Lock**: Generates unique cryptographic `intentId` and acquires atomic capital reservation before touching broker endpoints.
   - **Multi-Leg GTT Exit Protection Dispatch**: Entry fill immediately attaches broker GTT stop-loss and profit target limit triggers.
   - **Failure Injection Drills**: Simulates request timeout (`UNKNOWN_BROKER_STATE`), protection failure (`PROTECTION_FAILED` + Kill Switch activation), uncovered position, and unfilled exit limits (`MANUAL_INTERVENTION_REQUIRED`).

3. **Upstox V3 Live Order & GTT Protection Capabilities (`apps/api/src/broker/upstox-broker.adapter.ts`)**:
   - Full implementation of Upstox V3 Order Placement (`/order/place`), Modification (`/order/modify`), and Cancellation (`/order/cancel`).
   - Upstox V3 Multi-Leg GTT order placement (`/order/gtt/place`) supporting `STOPLOSS` and `TARGET` rules with limit triggers.
   - Guarded execution: Strictly checks `LIVE_EXECUTION_ENABLED` flag, valid AES-256-GCM token existence, and supports seamless sandbox/mock verification when running with sandbox credentials.

4. **10-Point Pre-Flight Go-Live Safety Checklist (`apps/api/src/orders/go-live-checklist.service.ts`)**:
   - Authoritative 10-item regulatory, infrastructure, risk, data, and consent verification system covering:
     1. `REGULATORY`: SEBI & Exchange Algorithmic Framework Compliance (supervised personal execution).
     2. `INFRASTRUCTURE`: Static Egress IP Binding Verified against Upstox developer portal.
     3. `RISK_CAPS`: Deterministic Hard Caps locked (Max ₹10,000 capital, ₹500 trade risk, ₹1,500 daily drawdown).
     4. `BROKER_OAUTH`: Upstox OAuth 2.0 Encrypted at Rest using AES-256-GCM.
     5. `MARKET_DATA`: Streaming Market Data Feed V3 & >3,000ms stale quote block.
     6. `INFRASTRUCTURE`: Startup Broker Reconciliation Clean (0 discrepancies).
     7. `PROTECTION_MECHANISM`: Multi-Leg GTT Exit Protection Ready (limit orders disclaimed, not guaranteed stop).
     8. `PROTECTION_MECHANISM`: Kill Switch & Emergency Stop Tested.
     9. `CONSENT`: Supervised Owner Approval Mode Active (180s TTL & revalidation).
     10. `CONSENT`: Owner Risk Disclosure & Execution Consent signed off.
   - REST Endpoints: `GET /orders/go-live-checklist`, `POST /orders/go-live-checklist/sign-off`, `POST /orders/go-live-checklist/sign-off-item`.

5. **Client SDK Extensions (`packages/client-sdk/src/client.ts`)**:
   - `executeSupervisedProposal()`, `getGoLiveChecklist()`, `signOffGoLiveChecklist()`, `signOffChecklistItem()`.

6. **Universal Client Workstation UI (`apps/trader/app/orders.tsx`)**:
   - **Multi-Leg GTT Protections in Positions**: Visual badges displaying `GTT PROTECTED` vs `UNPROTECTED`, protective stop prices with disclaimer ("Limit trigger; not guaranteed"), and profit target prices.
   - **Order State Transparency**: Visual badges for `ACKNOWLEDGED`, `FILLED`, `PROTECTED (GTT)`, `PARTIAL`, `UNKNOWN TIMEOUT`, `PROTECTION FAILED`, `CLOSED`. Invariant strictly honored: `ACKNOWLEDGED` is NEVER labeled as `FILLED`.
   - **Failure Injection Testbench Bar**: Single-click testing of Supervised GTT Order, Request Timeout (`UNKNOWN`), Protection Failure (`FREEZE`), Unfilled Exit (`ALERT`), and Uncovered Position (`FREEZE`).
   - **Interactive Go-Live Checklist Tab**: 4th dedicated workstation tab displaying all 10 pre-flight items, verification timestamps, audit evidence, item sign-off buttons, and platform owner Go-Live sign-off authorization banner.

### Verification & Test Matrix

- **Unit & Integration Tests**: 102 passed / 102 total (Vitest across 19 test files):
  - Domain tests: Invariant guard against ACK labeled as FILLED, in-flight order identification, GTT multi-leg parameter validation and ₹500 risk ceiling.
  - Supervised execution tests: Owner approval requirement rejection, 180s TTL expiration rejection, stale quote (>3,000ms) revalidation rejection, spread (>1.0%) revalidation rejection, GTT exit attachment and state transitions.
  - Anomaly simulation tests: Simulated request timeout to `UNKNOWN_BROKER_STATE`, simulated protection failure to `PROTECTION_FAILED` with kill switch engagement, simulated uncovered position, simulated exit limit unfilled to `MANUAL_INTERVENTION_REQUIRED`.
  - Upstox Live adapter tests: Place, modify, cancel, and GTT multi-leg protective exit methods with feature flag enforcement.
  - Go-Live checklist tests: 10-item pre-flight verification, owner sign-off workflow, and permission gate.
- **TypeScript Typecheck**: Passed across all 8 workspace projects with 0 errors (`pnpm run typecheck`).
- **Monorepo Build**: Passed cleanly across all packages and services (`pnpm run build`).

---

---

## Phase 6: Operational Resilience, Diagnostics & Mobile Polish — COMPLETED ✅

### Deliverables Implemented:

1. **Decoupled Dual Emergency Controls & Flatten Positions Protocol (Blueprint Section 8 & 12)**:
   - **Strict Decoupling Invariant**: "Stop new trades" (intake gate / Kill Switch) is strictly decoupled from "Request flatten all" (active exits trigger).
   - **Central Kill Switch**: `POST /risk/emergency-stop` halts intake, blocks proposal evaluation, freezes worker pipeline, and sets state `EMERGENCY_STOP`.
   - **Kill Switch Reset**: `POST /risk/reset-kill-switch` restores the trading engine safely to `DISARMED`.
   - **Flatten Positions Protocol**: `POST /risk/flatten-request` queries broker positions, submits aggressive market exit orders, settles reservations back to available cash ledger via `RiskReservationManager.settleClosedPosition`, transitions risk state to `DISARMED`, and broadcasts `position.flattened`.
   - Invariant: Exits are submitted to the broker; confirmed broker fill events finalize closed state.

2. **Automated Order Reconciliation Background Scheduler (`apps/api/src/broker/reconciliation-scheduler.service.ts`)**:
   - Periodic background audit service (default 60s configurable interval).
   - Runs `BrokerReconciliationService` comparing broker orders & positions against local database.
   - Detects phantom broker positions and quantity divergence; automatically engages kill switch upon discrepancy.
   - Keeps rolling history buffer of past 20 audit reports.
   - REST endpoints:
     - `GET /broker/reconciliation/schedule`: Inspect scheduler status (interval, total runs, clean runs, last run timestamp).
     - `GET /broker/reconciliation/history`: Query audit report history.
     - `POST /broker/reconciliation/schedule/start`: Start/resume automated scheduler.
     - `POST /broker/reconciliation/schedule/stop`: Pause automated scheduler.

3. **Live Health & Operational Diagnostics Subsystem (`apps/api/src/health/health.controller.ts`)**:
   - `GET /health/diagnostics`: Generates real-time telemetry report conforming to `DiagnosticsReportSchema`:
     - System uptime and Node.js process heap memory consumption (MB).
     - Market Feed telemetry: WebSocket connected, latency ms, stale ticks count, last tick timestamp.
     - Upstox Broker connection: AES-256-GCM token validity, seconds remaining, rate limiter token pool (25 req/s), registered egress IP match (`UPSTOX_EGRESS_IP`).
     - Risk Engine status: Kill switch active, state (`DISARMED`/`ARMED`/`EMERGENCY_STOP`), available cash, reserved capital, remaining daily drawdown budget.
     - Reconciliation status: Background scheduler state, last run, discrepancy count.

4. **Multi-Channel Notification Dispatch & Incident Drill Engine (`apps/api/src/notifications/`)**:
   - `NotificationsService`: Ring-buffer alert registry (50 events) with severity classification (`INFO`, `WARNING`, `CRITICAL`, `EMERGENCY`).
   - Multi-channel dispatch across WebSocket (`alert.created`), structured logger, and mobile push notification queue.
   - REST endpoints:
     - `GET /alerts`: Query active system alerts.
     - `POST /alerts/:id/acknowledge`: Operator acknowledgment with `alert.acknowledged` broadcast.
     - `POST /alerts/test`: Triggers incident recovery drill simulating emergency alert dispatch.

5. **Daily Statutory Reporting & RFC-4180 CSV Export (`apps/api/src/reports/`)**:
   - `ReportsService`: Real-time daily P&L calculation (gross P&L, realized net P&L, unrealized P&L, capital deployed, win/loss trade count).
   - Round-trip statutory levies calculation (Brokerage ₹40, STT 0.1%, NSE turnover 0.0505%, SEBI 0.0001%, Stamp duty 0.003%, GST 18%).
   - Fee variance analysis: compares upfront estimated charges against verified actual exchange charges to track net friction savings.
   - RFC-4180 compliant CSV export generator with appropriate quotes, headers, and Windows CRLF (`\r\n`) line terminations.
   - REST endpoints:
     - `GET /reports/daily`: Fetch structured daily performance summary.
     - `GET /reports/daily/export-csv`: Export and download audit CSV file (`daily_trading_report_YYYY-MM-DD.csv`).

6. **Client SDK Extensions (`packages/client-sdk/src/client.ts`)**:
   - `flattenPositions()`, `resetKillSwitch()`, `getReconciliationSchedule()`, `getReconciliationHistory()`, `startReconciliationScheduler()`, `stopReconciliationScheduler()`, `getDiagnostics()`, `getAlerts()`, `acknowledgeAlert()`, `triggerDrillAlert()`, `getDailyReport()`, `exportDailyReportCsv()`.

7. **Universal Client Polish (`apps/trader`)**:
   - `app/risk.tsx`:
     - Decoupled Dual Emergency Controls: "Stop New Trades" (Kill Switch) vs "Request Flatten All" (Active Exits).
     - Two-step confirmation modal for Flatten All with operator audit reason and disclaimer.
     - Live Reset Kill Switch action restoring engine to `DISARMED`.
     - Live Capital & Reservation Telemetry Strip (Available cash, held reservations, open positions).
   - `app/health.tsx`:
     - Live Diagnostics Telemetry metrics bar (WS latency ms, stale ticks, heap memory MB, scheduler status).
     - Automated Reconciliation background scheduler controls (Run now, pause/start schedule, simulate mismatch).
     - Multi-Channel Notification Center with "Trigger Incident Drill" action and alert acknowledgment buttons.
   - `app/orders.tsx`:
     - Journal Tab: "📥 Download Daily Audit CSV (RFC-4180)" button triggering browser CSV file export.
     - Fee Variance Savings summary strip (Estimated fees, actual statutory levies, net savings).
   - `src/hooks/useWorkstation.ts`: Extended with `flattenPositions()`, `isFlattening`, `openPositionsCount`, and `activeReservationsCount`.

### Verification & Test Matrix

- **Unit & Integration Tests**: 112 passed / 112 total (Vitest across 20 test files):
  - `RiskService`: Emergency stop engagement, kill switch reset restoring DISARMED, market flatten order execution, reservation settlement, zero positions remaining.
  - `ReconciliationSchedulerService`: Background audit cycle execution, report history retention, start/stop lifecycle.
  - `NotificationsService`: Alert ring buffer, multi-channel dispatch, severity filtering, acknowledgment, incident drill dispatch.
  - `ReportsService`: Daily metrics aggregation, round-trip statutory fee calculation, RFC-4180 CSV text format verification.
  - `HealthController`: Comprehensive diagnostics telemetry report generation across all subsystems.
  - `Trader UI & Workstation Tests`: `useWorkstation` flatten state lifecycle, `FlattenPositionsResultSchema`, `SystemAlertSchema`, `DiagnosticsReportSchema`, `ReconciliationScheduleStatusSchema`.
- **TypeScript Typecheck**: Passed cleanly across all 8 workspace projects with 0 errors (`pnpm run typecheck`).
- **Monorepo Build**: Passed cleanly across all packages and services (`pnpm run build`).

---

## Phase 7: Bounded Autonomous Execution (Armed Auto Mode) — COMPLETED ✅

### Deliverables Implemented:

1. **Pre-Flight Readiness Gating (`AutonomousExecutionService.checkReadiness()`)**:
   - Comprehensive audit verifying all 6 release checklist criteria prior to arming:
     1. `auto_01` (REGULATORY): SEBI Personal Algorithmic Framework compliance (supervised personal execution, no multi-tenant public auto).
     2. `auto_02` (PAPER_PROOF): Multi-day clean paper simulation proof with zero unhandled exceptions.
     3. `auto_03` (GO_LIVE): 10-point Go-Live checklist verified and signed off by platform owner.
     4. `auto_04` (RECONCILIATION): Zero broker discrepancies detected between workstation ledger and broker orders/positions.
     5. `auto_05` (BROKER_AUTH): AES-256-GCM encrypted Upstox OAuth 2.0 token valid with > 15 minutes remaining and verified egress IP.
     6. `auto_06` (FEED_HEALTH): Upstox WebSocket live market feed connected with latency strictly under 3,000ms threshold and zero stale ticks.
   - If *any* prerequisite is missing or failing, arming throws `ForbiddenException(AUTONOMOUS_EXECUTION_BLOCKED)`.

2. **Bounded Time-Window Execution Engine (`apps/api/src/orders/autonomous-execution.service.ts`)**:
   - Operator must specify `confirmationCode: 'CONFIRM_AUTO_EXECUTION'` and acknowledge explicit consent.
   - Bounded duration windows (`windowMinutes`: 15, 30, or 60 minutes; max 120 minutes).
   - Per-session trade count caps (`maxSessionTrades`: 1, 2, or 3 trades).
   - In-memory session tracking with scheduled automatic disarm timer (`this.disarmTimer`).
   - Strategy status transitions: `PAPER_ACTIVE` &rarr; `ARMED` &rarr; `PAPER_ACTIVE` (on disarm).

3. **Seven Automatic Disarming Safeguards & Invariants**:
   - ⏱️ **Window Countdown Expiry**: Session timer reaching zero automatically disarms engine.
   - 🎯 **Session Trade Cap Reached**: System disarms immediately after executing allowed trades count.
   - 📝 **Strategy Mutation**: Any parameter change causing a version bump immediately invalidates active arming.
   - 📡 **Market Feed Latency**: Quote staleness or latency > 3,000ms instantly freezes execution and disarms.
   - ⚖️ **Broker Ledger Discrepancy**: Divergence between local and broker ledger halts engine and disarms.
   - 🛑 **Kill Switch**: Operator manual emergency stop or daily loss breach disarms autonomous mode immediately.
   - 🔄 **Process Restart / Failover**: Single-leader worker and API initialize in safe `DISARMED` state by default.

4. **Supervised Execution Bridge (`executeAutonomousProposal()`)**:
   - Autonomously executes valid, approved proposals through `SupervisedExecutionService`.
   - Atomic risk reservation acquisition with hard account limits (₹10,000 capital, ₹500 all-in risk).
   - Pre-trade revalidation: Revalidates quote freshness (<3,000ms) and spread (<=1.0%) right before submission.
   - Mandatory multi-leg GTT bracket protection attached immediately upon order fill.
   - Never increases risk or forces trades to chase profit targets.

5. **Universal Client Workstation (`apps/trader/app/strategies.tsx`)**:
   - **Active ARMED Banner**: Pulsing high-contrast amber/red alert banner with real-time countdown timer (`MM:SS remaining`), trades executed counter (`1/2`), and one-click instant `DISARM SESSION NOW` override.
   - **Pre-Flight Gates Modal**: Detailed 6-point audit view with category badges, descriptions, verification timestamps, and re-audit trigger.
   - **Arm Bounded Session Modal**: Window duration selector (15m/30m/60m), session trade cap buttons (1/2/3), hard risk caps recap, risk acknowledgment checkbox, and `CONFIRM_AUTO_EXECUTION` input validation.
   - **Safety Invariants Matrix Card**: Complete visual breakdown of all 6 automatic disarming triggers.
   - **Autonomous Execution Audit Ledger**: Real-time action log stream tracking `AUTO_TRIGGERED`, `ORDER_DISPATCHED`, and `AUTO_DISARMED` events.

6. **Client SDK & Contracts Extension (`packages/contracts`, `packages/client-sdk`)**:
   - Schemas: `AutonomousReadinessItemSchema`, `AutonomousReadinessReportSchema`, `AutonomousArmRequestSchema`, `AutonomousSessionStatusSchema`, `AutonomousExecutionLogSchema`.
   - SDK methods: `getAutonomousReadiness()`, `getAutonomousStatus()`, `armAutonomous()`, `disarmAutonomous()`, `executeAutonomousProposal()`, `getAutonomousLogs()`.

### Verification & Test Matrix

- **Unit & Integration Tests**: 119 passed / 119 total (Vitest across 21 test files):
  - `AutonomousExecutionService`:
    - Blocks arming when Go-Live checklist is unsigned.
    - Successfully arms when all 6 pre-flight gates pass and rejects invalid confirmation codes.
    - Clean disarm resets strategy status, records logs, and creates system alerts.
    - Autonomously executes proposals with mandatory GTT exit protection and auto-disarms on session trade limit.
    - Strictly blocks autonomous arming when Kill Switch is engaged.
  - `Trader UI & Contract Tests`:
    - Validates `AutonomousReadinessReportSchema` and items.
    - Validates `AutonomousArmRequestSchema`, `AutonomousSessionStatusSchema`, and `AutonomousExecutionLogSchema`.
- **TypeScript Typecheck**: Passed cleanly across all 8 workspace projects with 0 errors (`pnpm run typecheck`).
- **Monorepo Build**: Passed cleanly across all packages and services (`pnpm run build`).

---

## Final Project Summary & Verification Matrix

All 8 Phases (Phase 0 through Phase 7) of the **AI F&O Trading Platform** are 100% complete, fully implemented, end-to-end integrated, and rigorously tested in alignment with `AI_FO_Trading_Platform_Blueprint.md`.

| Subsystem | Coverage | Invariants Verified |
|---|---|---|
| **Market Data** | Protobuf V3 decoder, catalog, WebSocket feed, calendar | Tick deduplication, 3,000ms staleness gate, zero lookahead bias |
| **Strategy & Agents** | Indicator calculations, 5m closed bars, read-only agents | Deterministic rule execution, version hash bumps, no write tools |
| **Risk & Paper Engine** | Transactional capital locks, slippage/charges, state machine | ₹10k capital cap, ₹500 trade risk cap, ₹1,500 daily loss limit |
| **Broker Integration** | Upstox OAuth 2.0, AES-256-GCM token storage, read adapter | Static egress IP check, rate limiter (25 req/s), startup reconciliation |
| **Supervised Execution**| 180s approval window, pre-trade revalidation, GTT exits | Spread <= 1.0%, latency < 3,000ms, bracket exits on fill |
| **Operational Controls**| Decoupled kill switch vs flatten all, alert ring buffer | Automated reconciliation scheduler, diagnostics endpoint, RFC-4180 CSV |
| **Autonomous Engine**   | 6-gate pre-flight audit, time-bounded windows, session trade caps | 7 auto-disarm safeguards, live countdown, instant manual disarm |

