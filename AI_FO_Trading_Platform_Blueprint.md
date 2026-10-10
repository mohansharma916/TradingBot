# AI-ASSISTED F&O TRADING PLATFORM

**Product Requirements Document + Solution Architecture + Development Playbook**  
**Target platforms:** Android, iOS and browser (shared React Native/Expo application)  
**Broker:** Upstox | **Market:** Indian exchange-traded futures and options  
**Version:** 1.0 | **Research checked:** 10 October 2026  
**Intended use:** Personal trading account; controlled progression from simulation to live orders

---

## Executive brief

Build a personal trading workstation where the owner configures capital and risk limits, creates strategy configurations, delegates market analysis to specialized agents, reviews trade proposals, and eventually authorizes limited automated execution through Upstox. The same **application codebase** powers Android, iOS and the authenticated web dashboard. A continuously running backend owns market connections, risk checks, strategy evaluation, execution and audit history.

**Product principle:** Agents may suggest trades; only deterministic validation and an explicitly armed execution policy can release an order. A model output is not an order instruction.

**First-release recommendation:** Paper trading and human-approved live execution only. Autonomous live execution is gated behind simulation, reconciliation and failure tests. Never make a daily profit target a reason to increase risk or force a trade.

| Design decision | Selection | Why |
|---|---|---|
| Universal client | Expo + React Native + React Native Web + Expo Router | One navigation/component foundation for mobile and browser |
| Backend | NestJS + TypeScript + PostgreSQL | Strong typing, guards, API and WebSocket support; maintainable modular monolith |
| Live trade runtime | Dedicated long-running NestJS worker / process | Must continue when web and mobile apps are closed |
| AI layer | Tool-restricted research/coordinator agents | Explain and rank proposals; do not own broker credentials |
| Broker adapter | Upstox behind `BrokerPort` interface | Simulation/live separation and future broker portability |
| Market feed | Upstox Market Data Feed V3 | Server-side WebSocket, protobuf decoding and standardized quotes |
| Risk and order execution | Deterministic state machines | Reproducible decisions, safe retries and auditable behavior |
| Deployment | AWS EC2 with Elastic IP, Docker Compose, HTTPS | Stable public egress IP for Upstox order requests |

### Financial assumptions: explicitly separate goal from guarantee

- Total trading capital: **₹10,000** (configured account-wide, **not** per agent).
- Proposed per-trade maximum adverse outcome: **₹500**. Define whether this means **including** all costs. The recommended engine interprets it as **all-in**, including estimated taxes, brokerage and slippage allowance.
- Preliminary transaction-cost budget: **₹60 round trip**. It is only a hypothesis; calculate both legs and then reconcile with broker statements.
- Desired profit on a successful trade: **₹300 net after charges**. With ₹60 estimated charges, gross target would be ₹360 before any additional slippage.
- Desired daily profit: **₹4,000**. This is a **40% daily return on ₹10,000**, not a reasonable expected or required result. Store it as an informational milestone only; never chase it.
- At ₹300 net per winner, 14 consecutive wins yield ₹4,200. In a 20-trade day with ₹500 all-in per loser, 18 wins and 2 losses yield ₹4,400: **90% wins**. This illustrates how fragile the target is, not a forecast.
- An initial live-trading safety profile should be materially stricter than the requested maximum (e.g., ₹200 all-in trade risk, ₹600 daily drawdown, one open position). These are software guardrails, not a claim that an exchange fill respects them.

> **Critical warning:** Options are leveraged and volatile. Stops can slip or fail to fill. A budget cap is an order-sizing and decision-control limit, never a guaranteed ceiling on realized loss. Futures and uncovered option writing will usually not fit a ₹10,000 account. All instrument and margin eligibility must be checked in real time.

---

## 1. Scope and success criteria

### 1.1 In scope

1. One owner and one Upstox account at launch; keep a multi-account-ready broker abstraction but no public multi-tenant product.
2. Responsive web dashboard plus Android/iOS app sharing route logic, domain types, queries, components and design tokens.
3. Watchlists, searchable F&O instruments, expiry/lot-size metadata, option chain and live quotes.
4. Strategy library: indicator-based and rule-based strategies with versioned immutable configurations.
5. Agent workspace: assign analysis tasks and observe evidence, proposals, rejection reasons and agent performance.
6. Simulation, backtest and paper-trade execution; manual and approved-live trade flows later.
7. Broker connectivity: OAuth, funds, margins, charges, order placement/modification/cancellation, GTT where supported, positions, fills and reconciliation.
8. Deterministic portfolio-level risk management, daily locks, emergency stop, audit log, reports and notifications.
9. Full lifecycle handling: retries, partial fills, stale market data, closed market, expired tokens, restarts, disconnections and order-state mismatches.

### 1.2 Out of scope for MVP

- HFT, latency-arbitrage, exchange co-location or guarantees of returns.
- Trade execution directly from the mobile device, unapproved prompt-to-order commands, third-party clients or managed customer funds.
- Uncovered short options or index/stock futures until available margin and controls justify them.
- Independent strategy orders issued by several agents without a shared account lock.
- LLM generation of raw broker API requests without typed schema validation.

### 1.3 Measurable acceptance criteria

- 100% of live orders can be traced to a user/strategy version, signal, risk decision, approved command, API request and broker order ID.
- No live order is possible when the system mode is PAPER, approval is missing in APPROVAL mode, or the kill switch is set.
- Every restart reconciles broker positions and outstanding orders before new orders resume.
- No duplicate order is created by retrying a timed-out request without establishing the broker-side state.
- UI shows broker-verified positions and available cash, not just optimistic local calculations.
- Identical core screens and domain logic function across web, Android and iOS, with documented web/native deviations.

## 2. User journeys and access modes

### Mode A: PAPER (default)

1. Owner connects read-only account data if desired; simulated trades use real-time or recorded market data.
2. Owner chooses strategy, instrument universe, timeframe, risk profile and virtual bankroll.
3. Strategy generates candidates; risk gate calculates cost, lot-size compatibility and estimated adverse outcome.
4. Paper broker generates plausible bid/ask-aware fills, slippage and fees; dashboard records results.
5. Daily recap reports realized net P&L, rejected candidates, slippage assumptions and drawdown.

### Mode B: APPROVAL (first production mode)

1. Agent creates a structured `TradeProposal` with objective evidence.
2. Risk engine checks market open status, feed freshness, funds, lot size, allowed contract, spread, charges, reserved exposure, daily cap and order permissions.
3. Owner receives the proposal on phone/web and approves it with a short expiration window and reauthentication for sensitive actions.
4. Backend **revalidates all conditions after approval**, then submits through Upstox.
5. Broker fills are tracked and a protective exit is set up using a supported GTT/exit mechanism; if protection cannot be established, stop entry progression and execute the configured emergency response.

### Mode C: AUTO (later and OFF by default)

1. Owner arms one approved strategy version, a session duration, permitted symbols and conservative limits.
2. Trading worker evaluates signals and submits only after every deterministic safeguard passes.
3. Any loss cap, stale feed, duplicate intent, desynchronization or network failure freezes new entries and sends an alert.
4. Owner can immediately disable new entries; closing positions is an explicit, separately acknowledged action.

## 3. Client architecture: one codebase, three targets

**Recommended path:** `apps/trader` is one Expo universal app using TypeScript, Expo Router, React Native Web, platform-neutral components and responsive layouts. Use `*.web.tsx` / `*.native.tsx` overrides only when necessary (e.g., advanced multi-pane chart on desktop). All data access is through your NestJS API. The client never contains Upstox API secrets or creates broker orders directly.

### Universal design rules

- **Responsive dashboard:** desktop sidebar, 2-3-column panels, option-chain table; compact mobile tabs, stacked cards and bottom sheets.
- **Navigation:** one typed Expo Router tree, same logical pages and deep links across devices.
- **Component layer:** `View`, `Text`, `Pressable`, shared primitive controls, accessible focus/labels; cross-platform styling via a consistent token system.
- **Charting:** chart data models and analytics are shared; allow a web-only advanced chart and a native-optimized alternative behind an interface.
- **Data fetching:** TanStack Query and a typed shared API client; streaming values merged into bounded stores, not hundreds of per-tick screen re-renders.
- **State:** persistent UI preferences separate from server-owned order/position truth. Never execute trades from an `useEffect` triggered by UI render.
- **Notifications:** browser in-app alerts and mobile push for warnings. Push delivery is informational; backend actions must not rely on receipt.
- **Device security:** mobile Keychain/Keystore via secure storage; web secure session cookie on your domain; require recent authentication to ARM/AUTO or change risk limits.

### Navigation / screen inventory

| Screen | Shared content | Web-specific | Mobile-specific |
|---|---|---|---|
| Sign in / broker connection | status, scopes, connection | callback/confirmation panel | browser-based broker auth and return deep link |
| Dashboard | capital, net P&L, risk, active agents | multi-column widgets | cards, quick risk status |
| Markets | watchlist, option chain, prices | dense option-chain grid | strikes segmented list |
| Strategy Builder | symbols, indicators, entry/exit | side-by-side rule preview | step-by-step wizard |
| Agent Workspace | assign task, status, rationale | multi-agent board | task feed and approvals |
| Trade Proposal | signal, cost, max risk, expiry | inspector panel | full-screen approval sheet |
| Orders and Positions | broker order states, fills, exits | sortable table | swipe-safe cards, no trade by accidental gesture |
| Backtesting | equity curve, parameter runs | comparison panels | metrics and run history |
| Journal and Analytics | net P&L, charges, drawdown | downloadable detailed CSV | daily breakdown |
| Risk Center | arm/disarm, live lock, settings | audit sidebar | visible emergency stop button |
| Settings / Health | OAuth, feed, notifications | detailed diagnostics | simple status with drill-down |

## 4. High-level system architecture

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

     PostgreSQL: configs, positions, events, ledger
     Worker: feed, indicator windows, reconcilers, alerts
     Optional Redis: caching/coordination, NOT primary ledger
```

Use a **modular monolith** initially: API and worker run as separate processes from the same repository. Use one transactional PostgreSQL system of record, unique constraints and database account locks to prevent concurrent execution. Add Redis only when queue scale or controlled backpressure requires it; never assume queues guarantee an order was or was not placed.

### NestJS modules

`auth`, `broker-connect`, `instruments`, `market-data`, `strategies`, `signals`, `agents`, `proposals`, `risk`, `orders`, `positions`, `portfolio`, `fees`, `paper-broker`, `backtests`, `journal`, `notifications`, `audit`, `health`, `admin`.

### Deployment boundaries

- API process: REST/WebSocket subscriptions, owner authentication, approvals and settings.
- Trading worker process: one authoritative market-feed connection, strategy scheduling, risk assessment, order reconciliation, protected exit management, daily reset.
- Database: PostgreSQL with encrypted connections, daily backups, retention and migrations.
- Broker adapter: only backend possesses access tokens and whitelisted static egress IP.

## 5. Multi-agent model and tool permissions

An agent is a **task-focused assistant**, not an independently funded account. All agents share the same ₹10,000 trading budget and central exposure ledger.

| Agent | Inputs | Allowed outputs | Never allowed |
|---|---|---|---|
| Market Scanner | quotes, contracts, OI, watchlists | ranked symbols + evidence | place orders |
| Strategy Analyst | indicators, backtest profile | candidate signal + confidence rationale | claim guaranteed profitability |
| News/Context Analyst (optional) | verified sources, time | event risk flags | invent market prices |
| Trade Planner | candidate, margin, costs | typed `TradeProposal` | bypass lot-size/risk gate |
| Risk Reviewer | proposal and limits | `ALLOW`, `REJECT`, or `NEEDS_APPROVAL` explanation | change limits automatically |
| Position Monitor | broker positions, live quotes | exit recommendations, exception alerts | falsely mark exits filled |
| Performance Analyst | fills, charges, backtests | net analytics and retrospectives | modify history or execute trades |
| Coordinator | all task state | task assignment and summaries | direct unrestricted broker access |

**Agent contracts:** Every output must be validated against a strict Zod/JSON schema. Include timestamp, model version, confidence calibration, source instrument IDs, objective evidence and `expiresAt`. Reject unknown instrument keys, missing timestamps, stale data, malformed numerical fields, or unsupported trade instructions.

**Deterministic core:** EMA/RSI/VWAP calculations, lot sizing, stop price, fees, budget accounting, duplicate prevention, actual P&L and order decision gates are normal code. Agent chat can request `draft_strategy`, `run_backtest`, `summarize_positions`, `scan_universe` and `propose_trade`; it cannot invoke `place_order` directly. Only the orchestrator can invoke live broker methods after policy approval.

### Natural-language task example

> "Scan liquid NIFTY call options, only if the 5-minute EMA-20 trend filter and RSI confirmation are positive. Budget ₹10,000 total, risk no more than ₹200 all-in per trade, seek at least ₹300 net after estimated costs, max one position. Paper mode today."

This prompt is **parsed into a versioned strategy draft** that the owner reviews. The LLM cannot change account-level hard caps or turn on AUTO mode by itself.

## 6. Strategy representation and rules engine

Create both **declarative templates** (EMA + RSI + VWAP, breakout, reversal) and a controlled plugin interface for advanced code strategies. Use typed JSON, versioning and immutable published revisions. No arbitrary user JavaScript evaluated in your live worker.

### Example strategy JSON (illustrative, not validated profitability)

```json
{
  "name": "NIFTY EMA20 RSI Long Call",
  "version": 1,
  "state": "DRAFT",
  "tradeMode": "PAPER",
  "market": "NSE_FO",
  "underlying": "NIFTY",
  "allowedInstruments": ["LONG_CALL"],
  "timeframe": "5m",
  "session": { "start": "09:25", "lastEntry": "14:45", "timezone": "Asia/Kolkata" },
  "entry": {
    "all": [
      { "indicator": "EMA_CROSS_ABOVE", "period": 20, "source": "UNDERLYING_CLOSE" },
      { "indicator": "RSI_GREATER_THAN", "period": 14, "threshold": 55 },
      { "indicator": "MAX_BID_ASK_SPREAD_PCT", "threshold": 1.0 }
    ]
  },
  "selection": { "expiry": "NEAREST_ELIGIBLE", "moneyness": "ATM", "minVolume": 1000 },
  "risk": {
    "maxCapitalInr": 10000,
    "maxAllInTradeLossInr": 200,
    "maxAllInDailyLossInr": 600,
    "maxOpenPositions": 1,
    "maxTradesPerDay": 3,
    "targetNetProfitInr": 300,
    "maxRoundTripCostBudgetInr": 60
  },
  "exit": { "stopBasis": "OPTION_PREMIUM", "marketCutoff": "15:10" },
  "requiresApproval": true
}
```

All prices, cutoffs, expiries, lot sizes, min order units and products are validated against actual market/broker metadata and session status. The app may display theoretical values, but must not present an infeasible lot or stop as executable.

### Strategy lifecycle

`DRAFT -> BACKTESTED -> PAPER_ACTIVE -> APPROVAL_READY -> AUTO_ELIGIBLE -> ARMED -> PAUSED / RETIRED`.

Only user authorization changes `AUTO_ELIGIBLE -> ARMED`. Structural changes require a new strategy version and new approval. Each execution references the exact version that generated the signal.

## 7. Risk engine: policy hierarchy and calculations

### 7.1 Policy hierarchy (higher priority wins)

1. Global kill switch, broker/exchange restrictions, market session, and authentication health.
2. Account-wide capital, max drawdown, max number of open positions and total risk reservation.
3. Broker margin, instrument lot size, product permission, price bands, market liquidity.
4. Strategy-specific approved rules and maximum expected adverse outcome.
5. Agent recommendations and informational daily target (lowest priority).

### 7.2 Risk accounting

For a **long option** purchased at estimated entry premium `P` with lot quantity `Q`:

`CapitalRequired = P × Q + estimated entry costs + reserve`  
`GrossLossAtStop = (P - plannedStopFillPrice) × Q`  
`AllInRisk = GrossLossAtStop + estimated round-trip costs + slippage buffer`  
`TargetGrossProfit = targetNetProfit + estimated round-trip costs + slippage buffer`  
`RemainingRiskBudget = dailyLossCap - realizedNetLoss - worstCaseOpenRiskReservations`

Reject if `AllInRisk > min(maxPerTradeAllIn, RemainingRiskBudget)`. Calculate both the full paid premium at risk and stop-based expected risk; disclose that realized loss may exceed stop-based risk. Require available-to-trade cash ≥ estimated required funds, using verified broker balances/margins.

For the original requested ₹500 loss cap with ₹60 estimated charges, **₹440** remains for planned adverse price movement before slippage. A ₹300 net desired winner requires **at least ₹360 gross** before slippage if costs really total ₹60. If ₹500 instead means *trading loss before charges*, the full losing trade is at least **₹560** and the break-even win rate against ₹300 net winners is about **65.1%** (versus 62.5% for ₹500 all-in losses).

### 7.3 Non-negotiable risk safeguards

- Daily drawdown computed from confirmed realized net P&L plus a conservative mark-to-market allowance for open risk; define timezone and rollover policy explicitly.
- Server-side cash/exposure reservations under a lock by broker account, released only on confirmed cancellation/fill reconciliation.
- One unresolved entry intent per strategy/instrument/signal bar; broker `tag`/correlation ID and local unique constraint.
- Pause new trades on stale market feed, missing bid/ask, wide spreads, low liquidity, high volatility restrictions, unknown order state, expired OAuth or database unavailability.
- No martingale, averaging down, auto-revenge trades or limit escalation to meet profit targets.
- Time-based entry cutoff and end-of-day position handling; explicitly verify intraday product rules and broker square-off behavior.
- Emergency stop has two controls: **Stop new trades** and **Request flatten all**; the latter is not represented as filled until broker confirmations arrive.
- Always reconcile an instrument's full current exposure; a trailing stop or target should never create an unintended short position.

## 8. Order life cycle, protective exits and resilience

### State machine

`PROPOSED -> RISK_APPROVED -> USER_APPROVED (if needed) -> SUBMITTING -> ACKNOWLEDGED -> PARTIALLY_FILLED -> FILLED -> EXIT_PROTECTION_PENDING -> PROTECTED -> CLOSING -> CLOSED`.

Alternative states: `REJECTED`, `EXPIRED`, `CANCEL_REQUESTED`, `CANCELLED`, `UNKNOWN_BROKER_STATE`, `PROTECTION_FAILED`, `MANUAL_INTERVENTION_REQUIRED`.

Broker order acknowledgements indicate a request was accepted, **not** that it filled. Record every broker event and execution fill separately. On timeout, query orderbook/order history/positions before deciding on a retry. If state remains unknown, freeze that symbol's new trade attempts and page the owner.

### GTT versus in-house exit management

- Prefer documented **multi-leg GTT** with `ENTRY`, `TARGET`, and `STOPLOSS` only for supported contract/product/order combinations.
- GTT triggers submit **limit orders**; they are not guaranteed to fill. Trailing stop loss is a documented beta capability, so it requires separate readiness verification.
- Where multi-leg GTT cannot safely represent the strategy, a worker may manage exit orders with explicit state, disconnection policies and protective-failure escalation. Never describe a server-managed stop as broker-protected when the server is offline.
- If entry fills partially, adjust exits to **confirmed filled quantity**; keep protective quantity synchronized and never assume all orders filled at the same price.
- On entry execution followed by inability to establish protection, follow a preapproved conservative emergency policy, including attempted reduction/exit and owner alert.

## 9. Upstox integration map and onboarding

### 9.1 Account setup

1. Have an active Upstox account with the required F&O permissions and sufficient margin/funds.
2. Open the Upstox Developer/My Apps dashboard and create an appropriate trading app plus a sandbox app.
3. Register the HTTPS callback URL and server's stable **public egress IP** (e.g., EC2 Elastic IP). The phone's Wi-Fi/mobile IP is irrelevant because phone never calls order endpoints.
4. Store `client_id` and encrypted `client_secret` server-side; exchange OAuth authorization code only in the backend.
5. Implement redirect, CSRF `state`, token encryption, token-expiry alerts, logout/disconnect and session renewal. Do not scrape Upstox login or automate its security prompts.
6. Generate a separate sandbox token and test supported endpoints; do not treat sandbox fills as market-realistic.
7. Before live rollout, verify current Upstox app classification, permitted algo behavior, account-specific approval, exchange limits and SEBI framework. Record regulatory sign-off date in release checklist.

### 9.2 MVP broker API inventory

| Need | Upstox API/feature | Implementation priority |
|---|---|---|
| OAuth | Authorization and Get Token | P0 |
| Static IP | Get/Update Static IP | P0 |
| Balance | Get Funds and Margin V3 | P0 |
| Capital checks | Margin Details | P0 |
| Fees | Brokerage Details + actual Charges | P0 |
| Contract list | Instrument Search, Option Contracts | P0 |
| Chain | Put/Call Option Chain | P0 |
| Streaming | Market Data Feed V3 (+ authorized connection) | P0 |
| Portfolio status | Portfolio Stream/Order Book/Positions | P0 |
| Regular execution | Place/Modify/Cancel Order V3 | P1 |
| Protective orders | Place/Modify/Cancel/Get GTT | P1 |
| Fill details | Order Details, Order History, Get Trades | P1 |
| Research | Historical and Intraday Candles V3 | P1 |
| Research | Expired F&O candle/contract data where entitled | P2 |
| Safety | Exit All Positions / Kill Switch, where applicable | P1 |
| Compliance/ops | Exchange Status, Holidays and Market Timings | P0 |

**Canonical live entry example:** `POST https://api-hft.upstox.com/v3/order/place` with a Bearer token, valid `NSE_FO|...` instrument token, quantity in actual instrument units, product, side, price/trigger and unique `tag` (the documented tag size has a limit). Some order types are restricted, and API calls from unregistered IPs may be rejected. Read endpoint-specific parameters; never hardcode sample instrument IDs.

**GTT example:** `POST https://api.upstox.com/v3/order/gtt/place`. Support varies by product/contract. GTT triggers result in limit orders and may not fill. Confirm exact handling in sandbox and controlled live tests before marketing a 'guaranteed stop'.

**Rate limiting:** Upstox documents combined normal order request limits of 10/second, 500/minute and 2,000/30 minutes, with different rules for approved higher-throughput algos. Implement per-user combined token-bucket/backoff and keep execution well below limits. Regulatory criteria and broker rules can change.

### 9.3 Broker port interface

```ts
interface BrokerPort {
  getConnectionHealth(): Promise<BrokerHealth>;
  getFunds(): Promise<FundsSnapshot>;
  getMargin(req: MarginRequest): Promise<MarginEstimate>;
  getCharges(req: ChargeRequest): Promise<ChargeEstimate>;
  getInstrument(key: string): Promise<Instrument>;
  getOrders(): Promise<BrokerOrder[]>;
  getPositions(): Promise<BrokerPosition[]>;
  placeOrder(req: BrokerOrderRequest): Promise<OrderAcknowledgement>;
  modifyOrder(req: ModifyOrderRequest): Promise<OrderAcknowledgement>;
  cancelOrder(orderId: string): Promise<void>;
  placeProtectiveExit(req: ProtectiveRequest): Promise<ProtectionResult>;
}
```

Implement `PaperBrokerAdapter`, `UpstoxSandboxAdapter` and `UpstoxLiveAdapter`. Live adapter construction requires an explicit environment capability flag plus owner arming. Never substitute a live adapter when sandbox credentials fail.

## 10. Market data and strategy evaluation

- Bootstrap daily instrument master and symbol mapping (exchange code, actual contract ID, strike, CE/PE, expiry, lot, tick and session eligibility). Version snapshots because lot sizes and expiry schedules can change.
- Authorize Market Data Feed V3 WebSocket server-side, decode protobuf, normalize timestamps and sequence/quality flags, maintain bounded ring buffers for indicators.
- Maintain an **underlying-price indicator feed** separately from the **selected option's executable bid/ask/last prices**. An underlying EMA signal does not establish the price at which a derivative order can fill.
- Prefer confirmed candle close for rule evaluation and consistent backtests; prevent duplicate signals on reconnect or replay.
- Cache quotes with monotonic freshness checks and source timestamps; stale data means PAUSE rather than optimistic fallback.
- Client WebSocket sends throttled, aggregated snapshots; UI chart update rate is decoupled from risk/strategy evaluation rate.
- Log market-data gaps and source quality. Do not use a free cached quote as the sole source of an executable limit price.

## 11. Data model (PostgreSQL)

Use UUID PKs, `created_at`, `updated_at`, optimistic version on mutable settings, UTC timestamps, decimal NUMERIC for currency/price; do not use floating-point for money. All logs carry trace IDs and correlation keys.

| Table | Required columns (abbreviated) |
|---|---|
| `users` | id, login_subject, mfa_enabled, status |
| `broker_connections` | id, user_id, broker, encrypted_token_ref, expires_at, health, static_ip |
| `accounts` | id, broker_connection_id, currency, balance_snapshot, mode |
| `risk_policies` | id, account_id, effective_version, max_capital, trade_risk, daily_loss, open_count, armed_until |
| `strategies` / `strategy_versions` | id, owner_id, mode, config_json, hash, status |
| `agent_tasks` | id, agent_type, requested_by, objective, state, tools_used, output_ref |
| `trade_proposals` | id, strategy_version_id, instrument_key, evidence_json, expiry, requested_mode |
| `risk_decisions` | id, proposal_id, policy_version, decision, reasons_json, reserved_amount |
| `execution_intents` | id, account_id, signal_key UNIQUE, approved_by, command_hash, status |
| `orders` | id, intent_id, broker_order_id UNIQUE nullable, side, order_type, qty, status, tag |
| `order_events` / `fills` | id, order_id, event_type, broker_time, fill_qty, fill_price, exchange_id |
| `positions` | id, account_id, instrument_key, net_qty, avg_price, last_verified_at |
| `exit_guards` | id, position_id, stop_order_id, target_order_id, protection_status |
| `cash_ledger` / `fee_ledger` | id, account_id, category, amount, reference_id, estimated_vs_actual |
| `pnl_snapshots` | id, trading_day_ist, realized_net, unrealized, exposure, drawdown |
| `backtest_runs` / `paper_fills` | id, config_hash, data_window, assumptions, metrics, artifacts |
| `market_feed_health` | id, feed_name, last_seen_at, latency_ms, gap_count, state |
| `audit_events` | id, actor_type, action, entity_id, before_after_hash, trace_id, occurred_at |
| `outbox_events` | id, topic, payload, committed_at, published_at |

Indices: `orders(account_id,status)`, `fills(order_id,broker_time)`, `proposals(strategy_version_id,expires_at)`, `audit_events(occurred_at)`, `execution_intents(account_id,signal_key)`; unique broker event deduplication keys. Retain raw authoritative broker responses under strict redaction/access controls where legally and operationally appropriate.

## 12. Internal REST and WebSocket API contracts

Prefix `/api/v1`. User auth is independent of Upstox OAuth. Every mutation checks both role and operating mode; live mutations require recent authentication and a CSRF defense on cookie-authenticated web routes.

| Method | Route | Action |
|---|---|---|
| GET | `/me` | Current owner / permissions |
| POST | `/broker/upstox/connect` | Generate broker OAuth state/redirect |
| GET | `/broker/upstox/callback` | Token exchange, then redirect to app |
| GET | `/broker/health` | Auth, egress IP, stream, broker status |
| GET | `/markets/watchlist` | Aggregated quote snapshots |
| GET | `/markets/options-chain` | Expiry and strikes |
| POST | `/strategies` | Create draft configuration |
| POST | `/strategies/:id/backtests` | Queue replay/simulation |
| POST | `/agents/tasks` | Start approved non-executing agent task |
| GET | `/agents/tasks/:id` | Agent status and provenance |
| GET | `/trade-proposals` | Pending proposals |
| POST | `/trade-proposals/:id/approve` | User authorizes a time-limited proposal |
| POST | `/trade-proposals/:id/reject` | Reject proposal |
| GET | `/orders` | Orders and broker-verified statuses |
| GET | `/positions` | Positions and unrealized risk |
| GET | `/risk/status` | Limits, drawdown and locks |
| POST | `/risk/arm` | Arm permitted strategy for bounded session |
| POST | `/risk/disarm` | Stop new entries |
| POST | `/risk/flatten-request` | Explicitly request position exits |
| GET | `/reports/daily` | Actual/estimated P&L + fees |
| GET | `/health/live` | Process up |
| GET | `/health/ready` | DB, feed, broker state as appropriate |

Server->client WebSocket topics: `quotes.snapshot`, `strategy.signal`, `agent.task.updated`, `proposal.created`, `proposal.expired`, `order.changed`, `fill.created`, `position.changed`, `risk.locked`, `broker.health`, `daily.report.updated`. Use user-scoped authorization, sequence cursors and snapshot replay after reconnect.

## 13. Charges, P&L and transparent reporting

### Pre-trade estimate

Use Upstox Brokerage Details for relevant side(s) and combine all known applicable fees (brokerage, GST, exchange transaction charges, STT where applicable, stamp duty, SEBI fees) plus slippage reserve. Check if endpoint already includes specific components to avoid double counting. Label estimated costs and enforce a cap on expected **round-trip** costs, not just buy-side brokerage.

### Broker reconciliation

- On fill: store gross realized trading P&L by fill; recognize fees as separate ledger entries.
- Match actual broker charges against estimates when available; never retroactively overwrite pretrade estimates.
- Report `net_realized = trading_realized - total_actual_costs` with estimated costs explicitly flagged until finalized.
- Track capital deposited, withdrawn, fees, net P&L, return on deployed capital, max drawdown, win rate, avg win/loss, profit factor, slippage, failed/protected orders.
- Display separate metrics for **strategy-level results** versus actual account net results, preventing double-counting shared open positions.
- Daily goal card may track distance to ₹4,000 but must **never** bypass max drawdown and risk limits.

## 14. Backtesting, paper trading and evidence

A strategy is not ready for autonomous live trading because it performed well on historical underlying index candles. F&O backtests require contract-specific premiums, expiry/roll rules, option Greeks context when used, spread and real lot size. Historical expired-contract data may require Upstox Plus and is not necessarily available for every period or instrument.

Minimum engine: deterministic candle replay, market hours and holiday calendar, fill model with bid/ask or conservative spread, delay assumptions, fee model, expiry handling, maximum premium-at-risk, stop/target collision policy, out-of-sample period, warm-up candles, data gap handling.

Metrics: sample count, gross/net return, median return per trade, max equity drawdown, Sharpe only if justified by observation frequency, profit factor, average win/loss, expectancy, consecutive losses, drawdown duration, turnover, strategy drift, fee sensitivity, slippage sensitivity. Preserve input data version, strategy hash, code commit and run date for reproducibility.

**Gates:** tests for look-ahead bias and survivorship bias; walk-forward/out-of-sample review; multi-day live-paper observation; shadow evaluation alongside real quotes; manual-approval pilot; monitored AUTO only after explicit user opt-in. No invented minimum success-rate guarantee.

## 15. Security, controls and compliance checklist

- Authentication to your application: strong session management, passwordless or MFA, recovery controls and recent reauth for high-risk actions.
- Upstox OAuth: credentials never shipped to web/mobile; authorization-code exchange only backend, secure `state`, precise redirect URI, encrypted tokens and expiry handling.
- Secrets: AWS Secrets Manager/SSM or another secure server-side store; non-public DB and least-privilege IAM.
- API access: TLS, rate limiting, validation, typed DTOs, authorization per account, audit all risk/order mutations; CORS only trusted origins.
- Websocket: authenticated topics, bounded subscriptions, heartbeat and reconnect, snapshot sequence replay.
- Risk-policy changes: cannot silently increase live limits; user review, versioning and immutable record; independent global hard cap.
- AI safety: disallow agent access to tools that place/cancel orders, transfer funds, update policy or reveal tokens. Treat retrieved news and instructions as untrusted text.
- Monitoring: alerts for stale market data, restarts, broker rejection, exhausted daily loss budget, uncovered fills, network drops, order state divergence.
- Disaster recovery: regular database backups and restore drills, safe startup default DISARMED, reconciliation before any order path is enabled.
- Regulatory: review SEBI's retail algo framework, applicable NSE/BSE implementation standards and current Upstox requirements before enabling unattended live execution. A personal-use app does not exempt order flow from broker/exchange controls.
- Privacy: avoid leaking account IDs, balances or holdings into third-party LLM prompts without explicit consent and a clear data policy.

## 16. Infrastructure and repository layout

```text
trading-platform/
  apps/
    trader/                    # Expo universal app: android + ios + web
      app/                     # Expo Router route files
      src/features/            # responsive screens and interactions
      src/components/          # native/web UI primitives
      src/theme/               # shared design tokens
    api/                       # NestJS HTTP + client WebSocket server
    worker/                    # long-lived signal, risk and order runtime
  packages/
    contracts/                 # Zod DTOs, event contracts, enums
    domain/                    # pure typed pricing, indicators, risk calculations
    ui/                        # shared React Native UI components
    client-sdk/                # authenticated backend requests and query hooks
    config/                    # eslint, tsconfig, test defaults
  infrastructure/
    docker/                    # multi-stage Dockerfiles, compose
    nginx/                     # reverse proxy + TLS config
    terraform/                 # optional AWS IaC after MVP
    scripts/                   # migrations, backup/restore, reconciliation
  docs/
    adr/                       # architecture decision records
    runbooks/                  # outages, stop orders, reauth, emergency exit
    api/                       # OpenAPI and Upstox mapping
  .github/workflows/           # lint, test, scan, build, deploy
```

Use pnpm workspaces or Bun workspaces with a checked-in lockfile; do not mix lockfiles in CI. Node LTS for NestJS/Expo tooling; PostgreSQL 16+; Docker Compose for MVP. Keep indicator package deterministic and browser/node-safe (no direct native modules). Host the web build on an HTTPS origin; keep API and worker on stable egress AWS EC2. A public EC2 IP does **not** require exposing the API unauthenticated or exposing PostgreSQL to the internet.

### AWS deployment outline

1. Create minimal EC2 Ubuntu instance, Elastic IP, VPC security group (SSH restricted to trusted administration path; HTTPS public; database private).
2. Configure `api.example.com`, HTTPS via Nginx/Caddy, secret management and automated renewal.
3. Deploy PostgreSQL as private volume-backed container initially or managed RDS later; backups and capacity alerts are mandatory.
4. Deploy separate `api` and `worker` processes from a tested image. Ensure worker is single-leader per account; no duplicate stream/order consumers after redeploy.
5. Register the EC2 **egress** static IP with Upstox and reauthenticate if IP registration changes invalidate token.
6. Host Expo web build on S3/CloudFront or appropriate static host, with correct deep-link rewrites and strict CORS. Mobile builds via Expo EAS.
7. Pipeline: lint -> typecheck -> unit -> DB integration -> sandbox contract -> web/android/ios build -> staged deploy -> health/reconciliation checks.
8. Never permit a deployment to implicitly re-arm AUTO; default disarmed after any risky version or config change.

## 17. Failure-mode matrix and test plan

| Scenario | Required behavior | Test method |
|---|---|---|
| Web/mobile app closes | Worker continues; owner can return to accurate status | Kill clients during paper trade |
| Worker restarts after entry submitted | Start DISARMED, reconcile orders/positions | Restart between request/response |
| Broker order request times out | Query broker before retry; unresolved state freezes that intent | Proxy timeout injection |
| Partial fill | Risk reservations and exits reflect actual filled quantity | Fake broker fills 1/N |
| Stop triggered but limit unfilled | Warn, monitor exposure, execute approved escalation | Broker emulator with no liquidity |
| Duplicate WebSocket tick / replay | Same candle generates at most one executable intent | Replay duplicate events |
| Stale feed / market closed | Freeze new entries | Delay timestamps / holiday test |
| OAuth expired | Freeze live entry, request reconnect | Force 401 in sandbox |
| Spread widens during approval | Revalidate and reject if outside cap | Simulate quote change |
| Two agents recommend same option | Central reservation prevents duplicated exposure | Parallel concurrency test |
| Client calls order route directly | Requires authorization, state, idempotency and risk | Security test |
| Loss cap exceeded | No new entries and alert user | Deterministic ledger test |
| Price jumps through stop | Actual loss may exceed planned; record incident | Gap/slippage stress test |
| EC2 egress IP differs | Orders fail safely; health reports issue | Whitelist mismatch test |
| Unexpected order from broker app | Reconcile total exposure before new entries | Inject external broker order |

**Testing pyramid:** pure unit tests for indicator/risk/math; contract tests for Upstox DTO decoding; DB integration tests for locks, idempotency and ledger; sandbox tests for supported endpoints; end-to-end cross-platform flows; chaos tests for network/broker failure; security tests for permissions and secrets.

## 18. Delivery roadmap (parallel frontend/backend work)

| Phase | Deliverable | Parallel streams | Exit gate |
|---|---|---|---|
| 0 - Foundations | Monorepo, UI tokens, API contracts, CI | Expo shell; NestJS skeleton; PostgreSQL | All target apps start and test |
| 1 - Markets | Instrument catalog, watchlists, live feed | Universal markets UI; worker feed adapter | Freshness and reconnect tested |
| 2 - Strategy + agents | Strategy forms, versioning, bounded agent task tools | Builder screens; typed engine; agent coordinator | Explainable candidate, no broker write access |
| 3 - Simulation | Paper adapter and backtesting | Paper order UI; simulated fills; analytics | Full lifecycle and accurate fees model |
| 4 - Broker read-only | OAuth, positions, funds, charges, margins | Connection UX; adapter and ledger | Tokens protected, broker account reconciles |
| 5 - Approval trading | Risk gate, approve order, supported exits | Approval UX; execution orchestration; runbooks | Sandbox + controlled live acceptance |
| 6 - Observability | Alerts, operational health, emergency actions | Mobile notifications; logs; incident drills | Restart/disconnect/partial-fill tests pass |
| 7 - AUTO gated | Session arming, safe run windows, kill switch | Risk policy UX; bounded auto worker | Regulatory and user release checklist complete |

Do not schedule AUTO before Phase 5 and Phase 6 have passed. The roadmap is a dependency order, not a claim that each phase will take a fixed number of days.

## 19. Development instructions for an AI coding IDE

Use the following prompts **one phase at a time**. Each prompt requires finished code, migrations, tests, command output and documentation. Do not ask the coding IDE to create fake Upstox response shapes as though they were official; place mock fixtures under an explicitly labeled mock adapter.

### GLOBAL INSTRUCTION — paste before every phase

```text
You are a senior staff engineer building a personal Indian F&O trading
workstation. Implement the requirements in docs/blueprint.md. Safety is
an invariant, not a later feature. Keep a single Expo/React Native Web
app for Android, iOS and web and a NestJS modular-monolith backend with
PostgreSQL. Use TypeScript strict mode and shared Zod contracts.

At every step: (1) inspect existing code; (2) write a concise plan;
(3) implement real code, not placeholders; (4) add unit/integration
and UI tests; (5) run formatter, linter, typecheck, tests and builds;
(6) provide exact commands, files changed and honest failures.

Never put Upstox credentials in the app. Never connect any AI model
straight to a live broker order tool. Default to PAPER and DISARMED.
Live execution must require an explicitly configured broker adapter,
central risk checks and required approval/arming. If a broker API or
exchange rule is uncertain, isolate it behind an adapter interface,
mark it TODO-VERIFY, and block live behavior rather than inventing it.
```

### PHASE 0 — repository foundation

```text
Build a pnpm-workspace monorepo with apps/trader (Expo Router universal),
apps/api (NestJS), apps/worker (NestJS runtime) and packages/contracts,
domain, ui and client-sdk. Set up TypeScript strict, ESLint, Prettier,
Vitest/Jest as appropriate, testcontainers or ephemeral PostgreSQL for
integration, Docker Compose, env schema and GitHub Actions. Implement a
responsive dashboard shell with a sidebar on web and bottom tabs on
mobile, authentication placeholder only on local simulator and live-safe
mode banner. Provide repo-level dev/test/build scripts and README.
Done when web, Android and iOS builds are validated as far as local
platform availability allows; backend starts and migrations pass.
```

### PHASE 1 — instruments and streaming

```text
Implement Upstox broker read-only interfaces, instrument search and
contracts metadata, normalized quotes and Market Data Feed V3 protobuf
stream decoding server-side. Add stale-feed detection, reconnection,
market calendar and subscription management. Expose typed REST quote
snapshots and a client WebSocket with bounded fan-out. Build responsive
watchlist and options-chain screens. Use only confirmed endpoints from
Upstox documentation and labeled mocks for tests. Cover reconnect,
expired token, quote-gap and duplicate event scenarios.
```

### PHASE 2 — agent workspace and deterministic strategies

```text
Implement versioned StrategyConfig with Zod validation, 5-minute EMA,
RSI, volume and bid/ask spread filters. Implement MarketScanner and
StrategyAnalyst agents that can only call read-only typed tools and
produce expiring TradeProposal objects with evidence. No broker write
tool is permitted. Build strategy editor, agent-task board and proposal
inspector for the universal app. Add unit tests for indicator warm-up,
candle-close semantics, look-ahead prevention and invalid agent output.
```

### PHASE 3 — risk engine and paper broker

```text
Create pure deterministic account-wide RiskPolicy evaluation: budget,
per-trade all-in risk, daily drawdown, open positions, trade count,
slippage buffer, fees estimate, margin, lot-size and liquidity limits.
Implement transactional cash/risk reservations, unique signal intent,
paper broker with partial fills, order state machine and fill ledger.
Build paper trades, orders/positions and journal UI. Prove two agents
cannot double-spend capital, stale quotes block orders, and all P&L
has correct estimated-vs-actual cost labels. Live adapter MUST remain
unavailable in this phase.
```

### PHASE 4 — broker connection and read-only portfolio

```text
Implement secure Upstox OAuth code exchange, CSRF state, encrypted token
store, static-IP health report, session expiry and reauthentication
screen. Implement funds/margins/charges, orderbook, fills and positions
via a typed Upstox adapter. On startup reconcile broker positions and
app ledger; show mismatches and freeze entry execution. Implement API
rate controls, retryable read calls and structured redacted logging.
Use sandbox/fixtures to verify contracts; do not enable live writes.
```

### PHASE 5 — supervised execution with protected exit

```text
Add live order execution only behind feature flags, owner APPROVAL mode,
short-lived approval, revalidation, idempotent intent and account-level
lock. Implement documented Upstox Place/Modify/Cancel Order V3 and
supported GTT exits in the broker adapter. Track ACK, partial fills,
confirmed fills, pending protection, closed state and unknown outcomes.
Simulate request timeouts, uncovered positions and exit limit unfilled;
freeze new entries and alert. The UI must never label ACK as FILLED or
show a guaranteed stop. Test all states in sandbox or fixture harness,
then require an explicit manual go-live checklist.
```

### PHASE 6 — operations, reports and mobile/web polish

```text
Add risk center, pause/kill new entries, separate flatten request,
order reconciliation scheduler, live health diagnostics, alerts,
transaction fees reconciliation, daily net P&L and CSV export. Add
responsive wide option-chain view web-side and mobile touch-safe order
cards. Test the same end-to-end approval and disconnect flows in web,
Android and iOS environments. Configure EC2 Elastic IP, HTTPS, private
DB, backup/restore, automated deploy and broker egress IP verification.
```

### PHASE 7 — bounded autonomous mode (do not shortcut)

```text
Before coding auto execution, write and run a release checklist covering
current SEBI/exchange/broker algo rules, backtesting validity, out-of-
sample results, multi-day paper runs, failure injection, stop protection,
and owner consent. If any prerequisite is missing, implement only a
DISABLED auto-mode UI. Otherwise implement strategy-specific timed
ARMED state, per-session caps, global kill, strict allowed instruments,
alerting and automatic disarm on deployment/config/connection change.
The system must never increase risk or force trades to hit ₹4,000/day.
```

## 20. Final user acceptance checklist

- [ ] Web, Android and iOS share one Expo app, typed contracts and visual system.
- [ ] User can connect/disconnect Upstox without exposing credentials in clients.
- [ ] User sees live market quotes with freshness timestamp and option contract details.
- [ ] User can create, version, test and pause strategies.
- [ ] Agents explain candidate trades and operate without order-placement permissions.
- [ ] All-in fees and slippage reserve affect trade admission and net target calculations.
- [ ] Risk policies are authoritative across all agents and devices.
- [ ] Paper broker reproduces order statuses, fees, partial fills and trading ledger.
- [ ] Live approval flow rechecks risk immediately before broker submission.
- [ ] Every entry state is reconciled; protective-exit failures are visible and actionable.
- [ ] Daily max loss causes immediate no-new-entry state; profit goal never overrides it.
- [ ] EOD, market holiday, auth expiry, stale-feed and restart behavior are tested.
- [ ] All execution actions have an immutable audit trail and incident runbooks.
- [ ] AUTO cannot be enabled without explicit owner action and verified go-live gates.

## 21. Recommended source documentation (official references)

**Broker**

1. Upstox Developer API home: https://upstox.com/developer/api-documentation/
2. Order V3: https://upstox.com/developer/api-documentation/v3/place-order/
3. Multi-leg GTT (includes trailing stop beta): https://upstox.com/developer/api-documentation/place-gtt-order/
4. Market Data Feed V3: https://upstox.com/developer/api-documentation/v3/get-market-data-feed/
5. Option contracts: https://upstox.com/developer/api-documentation/get-option-contracts/
6. Option chain: https://upstox.com/developer/api-documentation/get-pc-option-chain/
7. Rate limiting: https://upstox.com/developer/api-documentation/rate-limiting/
8. Static IP: https://upstox.com/developer/api-documentation/announcements/static-ip-apis/
9. OAuth: https://upstox.com/developer/api-documentation/authentication/
10. Sandbox: https://upstox.com/developer/api-documentation/sandbox/
11. Brokerage charges: https://upstox.com/developer/api-documentation/get-brokerage/
12. Margin: https://upstox.com/developer/api-documentation/margin/
13. Funds and Margin V3: https://upstox.com/developer/api-documentation/get-funds-and-margin-v3/

**Platform and regulation**

14. Expo Router for universal applications: https://docs.expo.dev/router/introduction/
15. Expo web development: https://docs.expo.dev/workflow/web/
16. SEBI retail algorithmic trading framework, Feb 4 2025: https://www.sebi.gov.in/legal/circulars/feb-2025/safer-participation-of-retail-investors-in-algorithmic-trading_91614.html
17. SEBI implementation extension, Sep 30 2025: https://www.sebi.gov.in/legal/circulars/sep-2025/extension-of-timeline-for-implementation-of-sebi-circular-dated-february-04-2025-on-safer-participation-of-retail-investors-in-algorithmic-trading-_96979.html

*Documentation reflects material verified on 10 October 2026. Re-verify broker payloads, order restrictions, subscription entitlements, derivatives contract eligibility and applicable rules before implementation and each live release. This blueprint is technical planning material, not investment advice or a profit guarantee.*
