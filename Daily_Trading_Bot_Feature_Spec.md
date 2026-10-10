# Daily Trading Bot Setup & Strategy Execution
**Broker:** Upstox  
**Version:** 1.0 — 10 October 2026 | **Status:** Feature proposal, not a validated profitable strategy

> **Safety principle:** Automated execution is permitted only after deterministic risk checks, supported broker order protection, and a deliberate user authorization. A profit target is a performance objective, never a reason to force trades. No stop order guarantees execution at the requested price.

## 1. Feature objective
Build a **Daily Trading Bot** that lets the account owner configure how much capital may be deployed, define account-level and trade-level losses, select tested strategies, specify when trailing profit protection begins, and start a monitored trading session. The backend—not a mobile device or browser tab—continuously evaluates market data, proposes trades, verifies risk, executes through Upstox, manages exits, and records a complete audit trail.

The same feature must work on Android, iOS and web with a shared React Native/Expo codebase and a single backend, API contract and database. No trade-management logic may depend on the UI staying open.

## 2. Vocabulary and separation of concerns
**Saved Bot Template:** Reusable risk/automation configuration, such as "Conservative NIFTY Morning". May be cloned or edited; has version history.

**Trading Strategy Definition:** Versioned, testable market-entry/exit algorithm, e.g. "Trend Following — EMA/VWAP v1". A strategy has its own parameters, eligible instruments, backtest and paper-trade evidence.

**Daily Trading Setup:** Immutable snapshot of one template (or a new configuration) PLUS the selected, versioned strategy and parameters for a specific trading date in Asia/Kolkata. Later edits must not silently change a running session.

**Bot Session:** One execution instance associated with a daily setup. Has explicit states and an audit history. No more than one active live session for a given account unless explicitly designed with a globally enforced risk allocator.

**Trading Agent:** A component that analyses and proposes signals. Only the centralized execution controller may submit orders; all risk rules are deterministic and non-overrideable by an LLM.

**Profit activation threshold:** Estimated *net unrealized profit* at which the stop may begin trailing.

**Protected profit floor:** Lower amount of net profit the new stop is designed to preserve if it executes near the stop price. Not guaranteed due to gap/slippage/order rejection.

## 3. First-day and returning-user UX
### A. First trading day / no saved setups
1. The user opens **Trading > Daily Bot**.
2. If there are no saved templates or earlier daily setups, show one primary action: **Set Up Your First Bot**. Include a read-only preview of risk limits and an explanation of paper vs. live trading.
3. The setup wizard contains: (1) trading mode and fund allocation, (2) risk limits, (3) profit/trailing configuration, (4) instruments and trading hours, (5) strategy selection, (6) preflight review and explicit start confirmation.
4. A strategy must be selected before a bot session can start. The predefined strategy library is available even on the first day.
5. Save the configuration as a named reusable template if the user chooses; always save an immutable daily snapshot.
6. Default to **Paper Trading**. Live execution requires a separately enabled, authenticated and confirmed permission.

### B. Second and subsequent trading days
1. Show a **Today's Bot** landing page: previous results, remaining buying power, broker connection, current market status, and whether today's session already exists.
2. Offer **Reuse Last Trading Day**, **Choose Saved Setup**, **Clone Any Previous Day**, or **Create New Setup**. A weekend/holiday does not count as a trading day.
3. Reusing creates a *new dated snapshot*: never reuse yesterday's live order IDs, open-position identifiers, tokens, realized P&L or execution state.
4. Pre-fill the parameters but re-fetch and validate today's funds, eligible contracts, lot sizes, expiries, available margin and supported order types.
5. The user can edit the new setup without mutating historical setup records. Require explicit save and execution confirmation.
6. If an active or orphaned position/order exists from yesterday, block a new live session until the user reviews reconciliation and safe exit handling.

### C. Running-session controls
Display bot state, assigned strategy and version, live funds used, available funds, open positions, worst-case reserved risk, trade count, realized/unrealized/net P&L, protective stop status, trailing activation, last signal and audit log. Provide **Pause New Entries**, **Resume**, **Stop and Protect Existing Positions**, and **Emergency Exit** (best-effort order submission, with status confirmation). Stop must not silently cancel protective exits.

## 4. Daily setup fields and validation
All currency values are INR. All timestamps are stored in UTC and displayed in IST. Every financial amount must distinguish cash committed, expected loss, net P&L and estimated charges.

| Field | Definition / constraints |
|---|---|
| `tradingMode` | `PAPER`, `APPROVAL_REQUIRED`, `LIVE_AUTO`; default `PAPER` |
| `dailyCapitalBudget` | Maximum funds allocated for today's trades, must be <= verified available funds and <= user-set capital cap |
| `dailyMaxLossAllIn` | Hard trading-day loss budget including projected costs and risk on open positions |
| `perTradeMaxLossAllIn` | Largest acceptable modeled loss on one trade INCLUDING round-trip costs and slippage allowance |
| `maxEstimatedRoundTripCharges` | Optional rejection threshold, initially ₹60 if user enables it; recalculated per contract, quantity and order |
| `minNetProfitToActivateTrailing` | Net unrealized P&L threshold, e.g. ₹300; not a guaranteed minimum exit result |
| `desiredNetProfitLock` | Desired minimum protected net P&L once trailing starts, e.g. ₹100; independently configurable |
| `trailingAlgorithm` | `FIXED_POINTS`, `FIXED_PERCENT`, `ATR`, `SWING_LOW`, or `STEP_LOCK`; implement fixed/step first |
| `trailingDistance` | Points, percent, ATR multiplier or net-rupee step, depending on algorithm; must be exchange/broker valid |
| `minTrailAdjustmentTicks` | Suppresses insignificant order modifications |
| `trailUpdateCooldownSeconds` | Time between broker modification attempts; protect against rate limits |
| `maximumConcurrentPositions` | Initially 1 for a ₹10,000 example account |
| `maximumTradesPerDay` | Hard count of opened positions; optionally cap losing trades and consecutive losses |
| `maxCapitalPerPosition` | Separate position-level exposure cap |
| `maximumSpreadPercent` | Reject contracts with excessive bid/ask spread |
| `marketOpenBufferMinutes` | Do not trade immediately at open; configurable |
| `lastEntryTimeIST` | No new entries after cutoff |
| `mandatoryExitTimeIST` | Exit intraday positions by configured cutoff; account for exchange/broker square-off rules |
| `allowedInstruments` | Explicit whitelist: NIFTY/BANKNIFTY/other approved index option contracts; long options only in MVP |
| `dailyNetProfitObjective` | Optional display/notification goal; NEVER authorizes increased risk or extra trades |
| `onLossLimitBreached` | Freeze new entries; cancel pending entries and reconcile existing protective exits; optional manual/controlled liquidation |

**Initial example only:** total capital ₹10,000; risk per trade ≤ ₹500 **all-in**; fee ceiling ₹60 per round trip; trailing activation net +₹300; daily total-loss cap is a *separately chosen* limit, not assumed to equal the per-trade limit. A smaller initial risk budget is advisable for first live tests. UI must not silently assume ₹500 excludes fees.

**Blocking validation:** `0 < perTradeMaxLossAllIn <= dailyMaxLossAllIn <= dailyCapitalBudget` (where economically applicable); exchange lot size and tick size valid; capital and buying-power margin verified; costs+slippage leave positive room within per-trade risk; only whitelisted product/segment; fresh market data; broker authenticated; no unresolved stale orders; and strategy version approved for chosen mode.

## 5. Strategy library, custom strategy builder and approval lifecycle
Prepopulate the library with versioned *examples*, not claims of profitability: **Trend Following (EMA + VWAP)**, **EMA Pullback Continuation**, **Opening Range Breakout**, **VWAP Reclaim / Breakdown**, and **No Trade in Sideways Market** (a filter, not an order generator).

Each strategy card displays name, version, type, market regime, selected indicators, allowed underlyings, timeframe, direction, trailing rule compatibility, testing status, paper-trading results and maximum observed drawdown. Show `DRAFT`, `BACKTESTED`, `PAPER_APPROVED`, or `LIVE_ELIGIBLE` status; block live use without approval.

Custom builder supports indicator conditions, bar-close triggers, risk and exit conditions, allowed sessions, parameters and a JSON strategy DSL with validated schema. Do not interpret free-form LLM text as executable order code. Natural-language agents may **propose** a DSL change; the user must review and approve a new immutable version.

Testing progression: create draft → validate syntax and look-ahead bias → historical backtest with transaction costs and realistic slippage → out-of-sample/walk-forward test → paper trade with live market data → human authorization → limited live deployment. Store datasets, parameters and reproducible result metadata.

MVP should select **one active strategy** per session. Multi-strategy execution is a future phase requiring a shared portfolio allocator and signal-conflict arbitration; strategies must never independently spend the same ₹10,000.

## 6. Trend-Following strategy — precise example rules
**Intent:** Follow the current *underlying index* trend and buy a liquid call (bullish setup) or buy a liquid put (bearish setup); both positions are closed by **selling the owned option**. This is a hypothesis to backtest, not a profitable recommendation.

**Data and timeframes:** use 15-minute closed candles for trend direction and 5-minute closed candles for entry. Compute indicators on the NIFTY 50 / relevant index underlying, NOT directly on a changing option strike. Prefer liquid price data for the underlying; an index lacks directly comparable trade volume, so volume filters should use a suitable tradeable instrument or be omitted. Track premium/bid/ask of selected option separately for fills and stop management.

**Indicators:** EMA(20) and EMA(50) on 15m; session VWAP where valid for selected underlying/proxy; RSI(14) on 5m; ATR(14) on 5m. Optional ADX(14) regime filter >= 22; choose threshold by testing, not optimization alone.

**Bullish trend filter:** latest fully closed 15m close > EMA20 > EMA50 AND price above valid VWAP AND ADX >= configured threshold (if available). **Bearish filter:** 15m close < EMA20 < EMA50 AND below VWAP AND ADX meets threshold. Otherwise, no entry.

**Bullish CE entry:** after the bullish trend filter, wait for a 5m pullback near EMA20 (within a configurable ATR band) and a completed 5m candle that reclaims EMA20 or breaks a recent confirmed swing high; require RSI14 > 55 as example. Buy only if bid/ask liquidity, spread, premium and risk checks pass. **Bearish PE entry:** mirrored conditions; 5m bounce toward EMA20 and closed candle resuming downside; RSI14 < 45.

**Contract selection:** choose an allowed expiry and liquid ATM or slightly ITM option, using broker-provided instrument metadata (including actual lot size and tick size). Avoid illiquid contracts, contracts that exceed budget, and 0DTE/expiry-day setups in early tests unless deliberately enabled and separately validated. If the risk budget cannot support one complete lot, **NO TRADE**. Never assume fractional NSE option lots.

**Entry timing:** evaluate only on completed candles; require fresh quote data and market-open state. Use a configurable open buffer, last-entry cutoff and mandatory exit cutoff. Prevent re-entry on the same signal bar, overtrading after losses, and duplicate orders during reconnects.

**Initial stop:** set a protective option-premium exit before/with entry via supported linked broker-order flow when possible. Size position so (entry price - planned stop price) × contract units + estimated full round-trip charges + slippage allowance ≤ perTradeMaxLossAllIn. An additional exit rule on underlying invalidation or strategy reversal may close earlier. Broker stop is the fallback if strategy engine disconnects.

**Exit triggers:** initial stop hit; valid opposite/reversal signal; trailing stop hit; optional hard take-profit beyond activation threshold; trading-day cutoff; account risk guard; liquidity or connectivity risk where safe controlled exit can be submitted. If a hard target equals the trailing-activation threshold, the position would ordinarily close there and would not have room to trail; UI must prevent that contradictory configuration.

## 7. Trailing SELL order — long call/long put, activation and algorithms
### Key design
For a **bought** CE or PE, the protective exit is a **SELL** order of the same instrument and no more than the confirmed open quantity. Buying a put to express a bearish view does NOT make its trailing exit a BUY order. Short futures or short options require reversed exit semantics and are OUT OF SCOPE for the ₹10,000 MVP.

**Before profit activation:** initial broker-protected hard stop remains active. The system observes best executable bid / fresh quote and estimated exit expenses. Do not leave the position unprotected while waiting for a profit threshold.

**Activation condition (illustrative):**
`estimatedNetUnrealizedPnl = (currentExecutableBid - actualAverageEntryFill) * filledUnits - estimatedRoundTripCosts - estimatedExitSlippage`.
If `estimatedNetUnrealizedPnl >= minNetProfitToActivateTrailing` AND feed is healthy AND position/fill is confirmed, change state from `PROTECTED_STATIC` to `TRAIL_ACTIVATING`.

**Profit lock:** desired stop floor (per unit) = `actualAverageEntryFill + (desiredNetProfitLock + estimatedRoundTripCosts + slippageReserve) / filledUnits`. Validate this stop lies below an executable current price at a broker-allowed offset. A threshold of +₹300 does **not** mean ₹300 can necessarily be locked instantly; allow a lower separately configured floor, such as ₹100. Treat lock values as targets, not guaranteed realized proceeds.

### Recommended MVP algorithm: step-based profit lock
1. Activate trailing when fresh executable estimated net P&L reaches ₹300.
2. Attempt to improve the existing protective SELL stop to a broker-valid level targeting at least ₹100 *net locked profit*, when feasible.
3. For each further ₹100 increase in **peak** estimated net profit, improve the desired locked profit by a configured amount (for example ₹50), subject to valid pricing, spread, minimum tick movement and modification cooldown.
4. Never intentionally move the stop downward for long-owned options. Maintain `highestObservedExecutableBid` and `lastAcknowledgedBrokerStop`; treat pending modifications separately.
5. Do not submit repeated changes for tiny market movements. Persist state and reconcile confirmations from broker order updates.
6. Exit on trailing trigger or other earlier risk exit. Cancel/reconcile competing target/stop legs according to supported broker functionality; never accidentally place two independent full-position exits.

### Alternative: ATR-volatility trailing (later phase)
`candidateStop = highestObservedExecutableBid - max(ATR(optionPremium,14) * multiplier, minAbsoluteGap)`;
`nextDesiredStop = max(previousAcknowledgedStop, candidateStop, brokerValidProtectedProfitFloor)`;
apply exchange tick-size rounding, broker gap requirements, market constraints and a cooldown. ATR must be calculated on a reliable premium-price candle series; do not mistakenly use underlying index ATR in premium rupees. Use bid/ask and liquidity gates to avoid updating from an anomalous last-traded-price spike.

### Broker-native vs app-controlled trails
**Broker-native:** Upstox's documented beta Multi-leg GTT STOPLOSS `trailing_gap` allows trailing from the order's configured behavior. Best when that precise behavior matches the strategy and product eligibility. The API documents a trailing-gap lower bound linked to the current LTP-to-stop difference; validate this dynamically.

**Delayed activation after net ₹300:** Your custom rule requires a backend state machine to activate/modify a protective order *after* threshold; confirm supported modification semantics on the exact GTT order/product in sandbox before live use. Keep the original valid broker-protected stop in force until the broker acknowledges a revised one. If atomic safe modification is unsupported, do NOT simulate an unsafe cancel/recreate gap. Disable the delayed-trail mode for that contract rather than exposing an unprotected position.

**Broker trigger ≠ guaranteed fill.** A GTT triggers an order, and a limit order may not fill if price gaps or liquidity disappears. Detect partial fills, rejected changes, stuck exits, expired sessions and missing broker acknowledgments; reconcile against orderbook/position feed.

## 8. Risk engine — non-negotiable invariants
Use a single central account-risk allocator across all agents and sessions.

1. **Capital:** `reservedOpenCapital + plannedNewPositionMargin <= min(todayBudget, verifiedAvailableFunds)`.
2. **Single-trade worst-case:** `plannedPriceRisk + roundTripChargesEstimate + slippageReserve <= perTradeMaxLossAllIn`.
3. **Day-level bound:** conservatively block new trades when cumulative realized losing-trade amounts plus worst-case remaining open-position losses and exit costs would exceed `dailyMaxLossAllIn`. Also track today's net P&L drawdown as an independent tripwire.
4. **Portfolio-wide:** summed exposure and worst-case stop losses across positions never exceed available allocated risk; pending entry orders reserve capital/risk until canceled and acknowledged.
5. **Never increase quantities automatically to recover losses; never re-enter immediately after a rejected stop or a loss-limit event.**
6. **No entry without broker-valid protective exit plan.** When the provider's linked stop cannot be established, fail closed; use an explicit protective-state and exception workflow for fills already in the market.
7. **Prevent duplicates:** idempotency key on trading signal/strategy/contract/bar, order lock, fill reconciliation, restart-safe persisted states.
8. **Circuit breakers:** stale quote/feed, disconnect, order rejected, failed protection, excess slippage/spread, broker rate limit, unverified account state, abnormal volatility, market closed, auth expired.
9. **Stop is not guaranteed:** on gap events actual loss can exceed a configured limit; show this in UI/reporting.
10. **Human controls:** manual pause, emergency exit, revoke live-autonomy permission, full change and execution audit.

## 9. Bot lifecycle, agent permissions and recovery
**Session states:** `DRAFT` → `VALIDATING` → `READY` → `RUNNING` → `PAUSED_NEW_ENTRIES` → `STOPPING` → `STOPPED` or `ERROR_NEEDS_ATTENTION`.

**Trade states:** `SIGNAL_DETECTED` → `RISK_PENDING` → `APPROVAL_PENDING` (optional) → `ENTRY_SUBMITTING` → `ENTRY_PARTIALLY_FILLED/FILLED` → `PROTECTED_STATIC` → `TRAIL_ACTIVATING` → `TRAIL_ACTIVE` → `EXIT_PENDING` → `CLOSED`; alternate `REJECTED` and `UNPROTECTED_EXCEPTION` require alerts and reconciliation.

**Agent roles:** Market Scanner proposes liquid instrument candidates; Trend Agent emits typed signals with evidence; Risk Engine is deterministic code; Execution Controller is the only authorized broker writer; Position Guard monitors broker protective state; Report Agent calculates actual P&L. LLM agents may summarize, explain and propose strategy parameters but must not possess broker order credentials or bypass limits.

**Crash/restart recovery:** On startup fetch actual broker positions, orders, open GTTs and recent fills; match them by account, instrument, strategy/session and broker IDs; rebuild each state before sending any new order; freeze opening orders until reconciled. Broker WebSocket/webhook updates are inputs, but polling reconciliation is the authority when feeds are missed. Record every broker request, response, retry and final acknowledgment without secrets.

## 10. Platform architecture and API surface
**Clients:** Expo + React Native + React Native Web; shared forms, types, validation, design tokens and query hooks. Desktop web gets dense position tables; mobile gets step-by-step wizard and simplified monitor. Both call the exact same authenticated NestJS backend. Do not run orders, calculations or trailing updates in the browser/mobile app.

**Backend modules:** `auth`, `upstox-adapter`, `instrument-catalog`, `market-data`, `strategy-registry`, `indicator-engine`, `backtest-engine`, `daily-bot-config`, `bot-orchestrator`, `account-risk-engine`, `order-execution`, `position-monitor`, `trail-manager`, `portfolio-reconciliation`, `fees`, `reports`, `audit`, `notifications`. Use typed events and versioned configuration. Start modular monolith with an always-on worker; avoid prematurely creating microservices.

**Database:** PostgreSQL. Suggested core tables: `bot_templates`, `bot_template_versions`, `strategy_definitions`, `strategy_versions`, `strategy_test_runs`, `daily_bot_setups`, `bot_sessions`, `strategy_signals`, `risk_decisions`, `order_intents`, `broker_orders`, `broker_fills`, `positions`, `stop_trail_events`, `market_data_health`, `daily_pnl_snapshots`, `audit_events`, `notifications`, `broker_connections`. Encrypt tokens at rest; redact logs; never store access credentials in React Native or web storage.

**Application REST endpoints (suggested, not broker endpoints):**
- `GET /api/bot/today`, `POST /api/bot/setups`, `GET /api/bot/templates`, `POST /api/bot/templates/:id/clone`
- `GET /api/strategies`, `POST /api/strategies`, `POST /api/strategies/:id/backtests`, `POST /api/strategies/:id/paper-test`
- `POST /api/bot/setups/:id/preflight`, `POST /api/bot/setups/:id/start`, `POST /api/bot/sessions/:id/pause`, `POST /api/bot/sessions/:id/resume`
- `POST /api/bot/sessions/:id/stop`, `POST /api/bot/sessions/:id/emergency-exit`, `GET /api/bot/sessions/:id/report`
- `GET /api/bot/sessions/:id/events` (SSE or authenticated WebSocket for live dashboard)

**Upstox capabilities to integrate:** OAuth; live Market Data Feed V3; option contracts/chain; funds and margin; brokerage estimator; standard order place/modify/cancel; multi-leg GTT place/modify/details; portfolio order/position updates; static IP setup. Verify the exact product, segment, quantity and GTT trailing support rather than assuming universal availability. Always use registered server egress IP and comply with current algo trading rules.

## 11. Concrete frontend screens
1. **Bot Home:** First-day CTA vs returning-user four-way options; today's status, yesterday's recap, broker connection and safety banner.
2. **Setup Wizard / Step 1 — Capital:** trading mode, funds available, today's budget, position cap.
3. **Step 2 — Risk:** trade-level loss, day loss, charges ceiling, max trades, concurrent positions, spread limits.
4. **Step 3 — Profits/Trailing:** activation threshold, desired net lock, trailing algorithm, gap/step, optional hard target, simulated example graph and conflict warnings.
5. **Step 4 — Market:** allowed instruments, contract eligibility and time windows.
6. **Step 5 — Strategies:** predefined/tested cards, explanation, metrics, risk compatibility, create/test link.
7. **Step 6 — Preflight:** read-only resolved configuration, brokerage example, available funds, strategy status, market/broker health, risk simulation and final authorization.
8. **Bot Live Monitor:** net P&L, orders, filled positions, current bid, broker-confirmed stop, highest favorable bid, trailing state, countdown and pause/stop/emergency actions.
9. **Strategy Lab:** versioned visual rule editor, backtest runs, cost/slippage model, out-of-sample evidence, paper results and promotion controls.
10. **History and Report:** daily run comparison, strategy win rate, expectancy, drawdown, charges, slippage, skipped trades and rejection reasons.

## 12. Error cases and acceptance criteria
**Must test**: no saved setup; day-two clone; weekend previous-trading-day resolution; stale broker token; insufficient balance; insufficient funds for one complete option lot; spread > threshold; wrong/expired contract; strategy conflict; duplicate signal; partial fill; rejected/expired stop; modifying a stop fails; stale/missing bid; bot restart; missed webhook; dropped WebSocket; pause while trade is open; emergency exit while stop pending; reaching daily loss; activation threshold attained but lock floor not valid; trailing stop triggers but limit order doesn't fill; near-expiry cutoffs; clock/timezone boundary.

**Acceptance:**
- First day shows only new-setup onboarding as the primary setup action; later days show clone/reuse/create.
- Historical daily snapshots and strategy versions remain immutable and traceable.
- A session cannot run without strategy, fresh market/broker preflight and validated budget.
- Every market order intent produces a persisted risk decision; no agent can bypass the risk engine.
- All live entry orders have a validated protection workflow; no silently unprotected exposure.
- Trailing never loosens a broker-confirmed SELL stop on a long option and never exceeds actual filled quantity.
- No contradictory fixed-target-vs-trail activation rule can be saved without an explicit override design.
- Pause stops new entries; Stop/Exit actions manage existing position safety and report actual broker confirmation.
- Simulations include exchange-mandated lot sizes, brokerage/taxes, spreads, slippage and unsuccessful fills.
- Live and paper behavior share one strategy/risk logic with a broker adapter swapped out.
- Identical business states render correctly on mobile and web.

## 13. Phase-wise implementation requests for a coding AI
**Global rule:** inspect the existing repository before modifying it. Reuse its React Native / React Native Web architecture, NestJS modules and PostgreSQL conventions. Implement incrementally with tests; don't replace existing working modules. Never hardcode API secrets or simulate live broker fills as confirmed fills.

**Phase 1 — Persistence and flows:** create typed entities, migrations, template CRUD, daily immutable snapshots, first-day/returning-day decision logic, wizard screens and validations; seed a strategy library with definitions only.

**Phase 2 — Strategy Registry and Lab:** versioned strategy DSL and evaluator; OHLC candle ingestion, indicator library, trend strategy, historical backtest with no look-ahead, cost modeling, test result storage, paper trading.

**Phase 3 — Broker and Risk:** Upstox adapter, account/broker health, funds/margin/fees, instrument catalog, central risk reservations, preflight state and idempotent order intents.

**Phase 4 — Execution and Protection:** sandbox-assisted integration, confirmed fill tracking, linked broker stop/target protection, order and position reconciliation, partial fills, pause/stop/emergency controls and full audits.

**Phase 5 — Trailing:** implement fixed/step trailing in paper mode, high-watermark persistence, delayed activation at *net* profit, locked-profit floor, broker stop acknowledgments, fail-closed modification handling, and ATR trailing as optional next phase.

**Phase 6 — Live graduation:** risk-engine invariants, incident/recovery tests, shadow mode, manual approval, small-size pilot live controls, production metrics and alerts; fully automatic execution only with separately confirmed permission and broker/regulatory eligibility.

**Definition of done:** each phase ships typed code, schema migrations, API documentation, integration/unit tests, feature flags, error states, UI parity and a clear demonstration checklist.

## 14. References — source documentation
- Upstox Developer API overview: https://upstox.com/developer/api-documentation/
- Multi-leg GTT with `trailing_gap`: https://upstox.com/developer/api-documentation/place-gtt-order/
- Modify GTT: https://upstox.com/developer/api-documentation/modify-gtt-order/
- Upstox trailing GTT beta announcement: https://upstox.com/developer/api-documentation/announcements/tsl-gtt-order/
- Broker fee estimation API: https://upstox.com/developer/api-documentation/get-brokerage/
- Margin API: https://upstox.com/developer/api-documentation/margin/
- Market Data Feed V3: https://upstox.com/developer/api-documentation/v3/get-market-data-feed/
- Registered static IP guidance: https://upstox.com/developer/api-documentation/announcements/static-ip-apis/

**End of specification.**
