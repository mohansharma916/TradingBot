**Trading Bot — second audit, 10 October 2026 (Asia/Kolkata)**

**Verdict: still not ready for real-money trading. Data, fills, protection status and performance displays are not consistently trustworthy.** Several fixes are confirmed. Remaining defects can conceal open exposure, invent profits, execute different rules from those backtested, and prevent production services from starting. No profitable trading edge has been established.

Reviewed **HEAD `e42e718`**, including changes since `3179de0` and commit `94ceea5`. The working tree was clean for final review and validation. Scope covered the API, worker, frontend controls, Daily Bot, market/broker adapters, strategy calculations, backtester, risk controls and deployment entry points. This report replaces the earlier audit; its previous version remains in Git history.

The review used source inspection, fresh project checks, deterministic local probes and current official broker/exchange documentation. Probe broker responses were stubbed. **No real broker connection, order, cancellation or live-account validation was performed.** Findings concern this checkout, rather than an independently deployed instance. Only this report was edited.

| Your question | Current assessment |
| --- | --- |
| Is there fake data? | Yes: manufactured option contracts, quote liquidity, volume/OI, sample analytics/tasks, report figures and frontend execution events remain. |
| Is the entire project fake? | No. Indicator arithmetic, schemas, paper execution, risk reservations, OAuth/encryption code and parts of recovery are implemented. |
| Are the strategies proven profitable? | No. Running analysis and backtests use different rules; option prices are modeled and important accounting defects remain. |
| Can Daily Bot trade real money? | No. Its backend explicitly supports PAPER only. |
| Can another route reach a real broker? | Live request code exists behind token/mode/flag checks, but its protocol and fill lifecycle are incomplete. |
| Is it production ready for personal trading? | No. Single-owner use still needs truthful exposure, reliable exits, correct broker integration and working deployment. |
| Is this AI hallucination? | The inspected agent path is deterministic code. Most unsupported claims come from hardcoded values, simulation and incorrect state transitions, rather than demonstrated LLM output. |

**Changes since the previous audit**

| Earlier finding | Second-audit status | Evidence and remaining limit |
| --- | --- | --- |
| String `"false"` enabled live/MFA flags | **Fixed** | [schemas.ts](/Users/user/Documents/Projects/TRADING-BOT/packages/contracts/src/schemas.ts:38) uses an explicit true allowlist. Probe: unset, `"false"`, `"0"`, `"yes"` → false; `"true"`, `"1"` → true. |
| Live funds invented ₹10,000 or replaced genuine zero | **Fixed in the adapter; funding gate incomplete** | [getFunds](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/broker/upstox-broker.adapter.ts:94) returns zero without a token, preserves zero and throws on fetch failure. Execution still reserves configured capital without querying real live funds. |
| ₹1 account could buy one modeled lot | **Fixed for premium affordability** | [Capital check](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:100) returns an error and zero trades; entry sizing no longer forces a lot. Charges and wrong lot sizes still affect adequacy. |
| VWAP accumulated across trading dates | **Fixed** | [indicators.ts](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/indicators.ts:82) resets accumulation by date. Two-day prices 100/200 now produce VWAP `[100,200]`. |
| Outdated STT/exchange calculation rates | **Fixed in calculation; UI text stale** | [charges.ts](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/charges.ts:37) uses 0.15% STT and 0.03553% exchange fees. Daily Bot still labels the old percentages. |
| No-token feed falsely CONNECTED | **Fixed at connection entry** | [Market feed](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/market-data/upstox-market-feed.service.ts:178) reports DISCONNECTED. Quote provenance remains incomplete. |
| Seed quotes marked fresh | **Partial** | Seeds initialize stale; the existing timer clears that flag outside market hours. Reproduced on the audit date. |
| Target preferred over initial stop | **Partial** | Initial stop now precedes target when trailing is inactive. Trailing still uses the bar high before checking its low. |
| Open backtest position discarded at dataset end | **Partial; new defects confirmed** | DATASET_END is now recorded, but can report zero drawdown after a loss and an exit earlier than entry. |
| Wrong lot sizes/expiry schedules | **Unresolved** | Only lot-size comments changed. Revised expiry logic shifts dates with timezone and retains invalid schedules. |

The revised calculation rates match the dated [Upstox charges table](https://upstox.com/brokerage-charges/): option premium STT changed on 1 April 2026 and NSE option transaction fees on 1 March 2026. These remain hardcoded estimates rather than charges verified against broker contract notes.

**Fresh validation**

| Check | Result |
| --- | --- |
| `pnpm test` | Passed: **28 files, 233 tests**. |
| `pnpm typecheck` | Passed. |
| `pnpm build` | Passed for root targets; this script excludes the trader web build. |
| `node apps/api/dist/main.js` | Failed before bootstrap: ERR_MODULE_NOT_FOUND, `dist/app.module`. |
| `node apps/worker/dist/main.js` | Failed before bootstrap: ERR_MODULE_NOT_FOUND, `dist/worker.module`. |
| Compiled API protobuf assets | No .proto file emitted under apps/api/dist; the loader expects it beside compiled code. |
| Focused probes | Reproduced false fills, disarmed reservations, missing-quote bypass, expiry date shift, stale-seed regression, strategy mismatch and backtest defects below. |

Startup checks used Node **24.11.0**, after a fresh successful build. Passing tests does not establish broker compatibility, working deployment, genuine order protection or profitability. No separate trader web export, sustained paper session or live/sandbox broker integration test was performed.

**Critical findings — outstanding**

1. **The UI can confirm a closed position after a failed request.** [useWorkstation.ts](/Users/user/Documents/Projects/TRADING-BOT/apps/trader/src/hooks/useWorkstation.ts:140) clears displayed positions/reservations and resets cash to ₹10,000 before flatten confirmation. Its failure branch returns `success:true`. Emergency stop/disarm also swallow failures. [orders.tsx](/Users/user/Documents/Projects/TRADING-BOT/apps/trader/app/orders.tsx:121) creates an exit event/P&L and claims the position closed and GTT cancelled without confirmed fills. A screen can show no exposure while a broker position remains open. Preserve exposure until confirmed exit quantities reconcile; pending/failed requests must stay pending/failed.

2. **Some execution and approval success is fabricated in frontend state.** [Supervised Execute](/Users/user/Documents/Projects/TRADING-BOT/apps/trader/app/orders.tsx:180) inserts 25 units at ₹124, a UPSTOX_SIM order ID and a protected position locally, without an execution request in that handler. [Proposal approval](/Users/user/Documents/Projects/TRADING-BOT/apps/trader/app/proposals.tsx:66) updates optimistically; its failure branch claims validated freshness, locked capital and GTT protection. Other go-live/consent UI evidence is constructed locally. Derive success from actual results and identify simulation.

3. **Supervised live execution invents completed fills from acknowledgements.** [supervised-execution.service.ts](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/orders/supervised-execution.service.ts:176) transitions to FILLED, copies proposed quantity/price and commits capital without obtaining actual fills. A stub broker returning only ACK produced **PROTECTED, 25 units at ₹122.50 and a COMMITTED reservation**, despite supplying no fill evidence. Pending, partially filled and rejected orders can therefore receive incorrect position/protection accounting. Obtain broker-confirmed fill quantities and weighted prices before committing exposure or sizing protection.

   Its [freshness check](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/orders/supervised-execution.service.ts:96) is optional and skips validation when the quote is missing. The same probe executed with no quote and `revalidateFreshness:true`. Missing market data must block entries.

4. **The live broker adapter loses documented V3 order IDs and builds incomplete protection requests.** [Order placement](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/broker/upstox-broker.adapter.ts:258) uses UPSTOX_BASE_URL rather than the configured HFT host, lacks JSON Content-Type and reads singular data.order_id. The documented V3 response contains data.order_ids. A stub response with `order_ids:["REAL_V3_ORDER_ID"]` returned an invented upstox_TIMESTAMP ID. This prevents reliable lookup/cancellation/reconciliation. Match the [Upstox V3 order contract](https://upstox.com/developer/api-documentation/v3/place-order/) and retain every real order ID.

   The [GTT payload](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/broker/upstox-broker.adapter.ts:393) omits transaction direction and per-rule trigger_type; its two-rule MULTIPLE payload also differs from the documented contract. See [Upstox GTT API](https://upstox.com/developer/api-documentation/place-gtt-order/). A mock-token response generated locally does not validate real protection or represent a broker sandbox response.

5. **Owner authentication is not implemented on the reviewed API.** [auth.controller.ts](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/auth/auth.controller.ts:9) returns a fixed identity; [main.ts](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/main.ts:8) registers no authentication guard. Trading, risk, configuration and sign-off controllers remain unguarded. JWT/MFA configuration fields and corrected booleans do not authenticate a user. Enforce owner access on HTTP/WebSocket routes and mutations before exposing the API.

6. **DISARMED does not enforce a shared entry block.** [RiskService](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/risk/risk.service.ts:82) changes local status; [reservation acquisition](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/risk/risk-reservation.manager.ts:82) checks kill switch/capital/risk but not arming or expiry. A probe acquired a HELD reservation while RiskService reported DISARMED. Enforce mode, consent, arming expiry, kill switch and required data at the shared dispatch boundary.

7. **Ambiguous broker outcomes and unavailable reconciliation can appear safe.** The supervised [catch](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/orders/supervised-execution.service.ts:325) releases HELD capital after an exception, including possible broker acceptance followed by connection failure. Already COMMITTED reservations are protected by the manager's release guard; ambiguity before commit remains unsafe. Thrown protection/network errors after commit can bypass explicit kill-switch branches. Persist intents and retain unresolved exposure until verified reconciliation.

   [Reconciliation](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/broker/broker-reconciliation.service.ts:49) compares live exposure with paper state and can treat failed broker reads as empty arrays. Adapter read methods also return empty arrays on failure. Unavailable data against an empty local ledger can look CLEAN. Require successful complete reads before CLEAN and block entries when account state is unknown.

**High-priority data, strategy and deployment findings — outstanding**

8. **Quotes still combine real prices with manufactured execution information.** [Seed initialization](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/market-data/upstox-market-feed.service.ts:87) assigns fixed prices/volume/OI with current timestamps. Seeds now initialize stale, but [checkStaleFeed](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/market-data/upstox-market-feed.service.ts:319) recomputes that status from hours/age alone. On Saturday 10 October, seed initialization gave DISCONNECTED with five stale quotes; the checker produced **zero stale quotes with zero received ticks**.

   [REST/Yahoo normalization](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/market-data/upstox-market-feed.service.ts:457) invents bid/ask around a price, retains seeded volume and marks the quote current/non-stale. A probe retained **8,452,000 volume** after a price update. Genuine index LTP does not validate those liquidity fields. [Option-chain fallback](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/instruments/instrument-catalog.service.ts:246) still invents premiums, **54,000 volume**, **42,000 OI** and isStale:false. Markets labels any returned chain LIVE API. Add field-level source, exchange time and LIVE/DELAYED/SIMULATED/UNAVAILABLE status; fabricated data must not satisfy entry checks.

9. **Contract metadata remains synthetic and revised expiry logic is wrong.** [Catalog](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/instruments/instrument-catalog.service.ts:135) manufactures descriptive instrument keys rather than using actual broker tokens. [Bootstrap](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/instruments/instrument-catalog.service.ts:69) retains **2026-10-15**, uses a Wednesday weekly generator for BANKNIFTY and weekly-style dates for FINNIFTY. NSE currently specifies NIFTY weekly Tuesdays, BANKNIFTY monthly/quarterly contracts and FINNIFTY monthly contracts; monthly expiry is last Tuesday with holiday adjustment. See [NIFTY](https://www.nseindia.com/static/products-services/equity-derivatives-nifty50), [BANKNIFTY](https://www.nseindia.com/static/products-services/equity-derivatives-banknifty) and [FINNIFTY](https://www.nseindia.com/static/products-services/equity-derivatives-finnifty) specifications.

   **New timezone defect:** [getUpcomingExpiries](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/instruments/instrument-catalog.service.ts:36) creates local-midnight dates then serializes to UTC. Under Asia/Kolkata, Tuesday expiry generation returned **2026-10-12, 2026-10-19, 2026-10-26 and 2026-11-02: Mondays**. Load listed contracts/holidays from authoritative metadata and preserve date-only values independently of server timezone.

   [lot-size.ts](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/lot-size.ts:16) still executes **NIFTY 25 / BANKNIFTY 15 / FINNIFTY 25 / MIDCPNIFTY 50**. Only comments changed; those comments also cite obsolete revisions. The current published broker table lists **65 / 30 / 60 / 120** respectively. See [index lot sizes](https://support.zerodha.com/category/trading-and-markets/trading-faqs/f-otrading/articles/lot-size-for-index-derivatives). Use contract-specific metadata and historical sizes for historical tests. Wrong quantities distort affordability/risk/fees and order validity.

10. **Corrected funds responses are not enforced before live dispatch.** [getFunds](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/broker/upstox-broker.adapter.ts:94) no longer fabricates ₹10,000, but its no-token object lacks explicit unavailable/provenance status. [Risk ledger initialization](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/risk/risk-reservation.manager.ts:72) still uses configured capital, and execution does not obtain actual live funds. Refresh funds, existing account exposure and reservations at the live risk boundary; unavailable funding evidence must block orders.

11. **Profit reporting remains fabricated and mathematically incorrect.** [ReportsService](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/reports/reports.service.ts:30) counts SELL proceeds as profit without subtracting entry cost. Buy 25 units at ₹100, sell 25 at ₹90 should yield **−₹250 gross**; the code reports **₹2,250 gross**. BUY-only fills receive a seeded **₹350 realized profit**. Default trades/wins, ₹45 drawdown and ₹3,062.50 deployed capital are invented. Reports always read PaperBroker even if the mode field says otherwise. Rebuild performance from matched confirmed fills, charges and marked open exposure with clear paper/live provenance.

12. **Backtest option P&L is modeled rather than historical option performance.** [Entry premium](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:314) is 0.55% of index open; [option movement](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:190) assumes delta 0.5. Actual historical option contracts, volatility/expiry decay and executable spreads are absent. Genuine index candles do not validate modeled option fills. [Historical fallback](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:564) generates random candles. It identifies MARKET_CALENDAR_SIMULATION, while frontend text still implies fully real exchange data. Identify model output consistently and validate performance on real option data.

13. **Backtests and running analysis still execute different rules.** Backtests use AST at [backtest-engine.ts](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:306); [AgentToolsService](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/agents/agent-tools.service.ts:215), including Daily Bot's strict workflow, uses legacy EMA/RSI rules. A probe with an explicitly false AST condition still approved a PE candidate with **BUY_CALL**. Instrument filters do not implement the specified bearish strategy.

   AST stop/target/cutoff configuration remains ignored in relevant [backtest exit settings](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:143). Changing stop/target from 1 to 1000 and cutoff to 09:30 produced identical trades. Execute one canonical entry/exit strategy across backtest, paper and live.

14. **Backtest chronology and charge funding remain biased.** [Trailing logic](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:195) activates/tightens from a candle's high before checking its low. A spot 25,000 trade with a later bar high 25,100/low 24,900 produced **+₹1,142.34 trailing profit**, although the initial stop could have been hit first. The new conservative-ordering comment overstates the fix. Use finer data or conservative treatment of unknown intrabar order.

   The same loop can re-enter at the bar open, timestamped start + 5 seconds, after a recorded exit at start + 24/48 seconds. That reverses event order. [Capital checks](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:318) also fund premium only: **₹3,437.50 cash** bought **₹3,437.50 premium** while accruing **₹55.11 round-trip charges**. Include applicable charges/reserves in cash and risk accounting.

15. **New dataset-end settlement misstates drawdown and exit time.** [DATASET_END](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/backtest-engine.ts:351) updates running capital but omits normal peak/drawdown accounting. A probe settled **−₹180.11 net** while reporting **₹0 / 0% maximum drawdown**.

   Exit time is the last bar start; entry can be start + 5 seconds. A probe recorded **05:35:05Z entry and 05:35:00Z exit**, although settlement uses the bar's close. Share normal/end-settlement accounting and use a valid exit time after entry. Recording the final trade improves coverage, but its metrics remain unreliable.

16. **Versioning and several strategy claims remain unsupported.** [strategy-version.ts](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/strategy-version.ts:9) excludes AST, daily trade count and cost budget. Changing the AST exits above produced the same hash, so results/approvals can remain attached to changed logic. Hash every execution-affecting field.

   The [ORB template](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/strategy-templates.ts:502) uses a rolling prior-three-bar range rather than a frozen opening range. Runtime observed bars remain 5m despite configurable timeframes. [Confidence](/Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/strategy-evaluator.ts:234) starts at 0.72 and adds heuristic bonuses; it is not a calibrated probability. General/manual analysis still includes [seeded candle history/liquidity](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/agents/agent-tools.service.ts:259) and fabricated completed agent tasks. Describe actual logic and separate demo analytics from observed results.

17. **The V3 market-feed contract still differs from local decoding.** The [local proto](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/market-data/proto/MarketDataFeed.proto:39) defines flat FullFeed fields; [decoder](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/market-data/protobuf-decoder.service.ts:66) reads flat ltp/OHLC/depth and bp/ap names. Official V3 uses nested marketFF/indexFF.ltpc and different depth fields. Subscriptions send text JSON while the broker requires a binary request. See [Upstox V3 feed](https://upstox.com/developer/api-documentation/v3/get-market-data-feed/). Encoding/decoding with the same local schema does not demonstrate broker compatibility.

   [Missing depth](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/market-data/protobuf-decoder.service.ts:140) becomes bid=ask=LTP with zero quantities. Downstream spread checks can interpret that as perfect liquidity. Require actual executable depth/quantity/timestamps and preserve unavailable status.

18. **Readiness, live durability and deployment remain incomplete.** [GoLiveChecklistService](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/orders/go-live-checklist.service.ts:24) initializes nine checks passed, including consent/protection/reconciliation. Broker health hardcodes IP match, feed connection and 16 ms latency. The [worker](/Users/user/Documents/Projects/TRADING-BOT/apps/worker/src/worker.service.ts:36) assigns isLeader=true and logs clean reconciliation without a distributed lock or broker check. Readiness needs measured evidence.

   Standard [orders/positions APIs](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/orders/orders.service.ts:21) inject PaperBroker despite separate live dispatch. Broad live order/risk/approval/session state and tokens remain process-local. AES encryption exists, but memory-only token storage does not establish persistent encrypted-at-rest storage. Daily Bot's durable JSON store does not provide the broader live ledger or account leadership.

   Both compiled services fail on extensionless ES module imports; the API also omits its .proto resource. Fix packaging and verify actual production startup/recovery/reconciliation rather than treating compilation as deployability.

**UI inconsistency in the corrected charge calculation**

[DailyBotScreen.tsx](/Users/user/Documents/Projects/TRADING-BOT/apps/trader/src/features/daily-bot/DailyBotScreen.tsx:300) still labels STT **0.1%** and exchange fees **0.0505%**, while shared arithmetic uses **0.15% / 0.03553%**. [config.ts comments](/Users/user/Documents/Projects/TRADING-BOT/apps/trader/src/features/daily-bot/config.ts:21) are stale too. Correct labels and describe displayed fees as estimates pending actual execution charges.

**Daily Bot specifically**

[Supported mode](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/daily-bot/daily-bot.service.ts:156) remains PAPER; [start](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/daily-bot/daily-bot.service.ts:259) rejects live mode. The [execution service](/Users/user/Documents/Projects/TRADING-BOT/apps/api/src/daily-bot/daily-bot-execution.service.ts:26) injects PaperBroker and enforces paper mode. A valid broker token does not turn this path into live trading.

Useful safeguards are implemented: immutable setup snapshots, durable intent checkpoints, confirmed simulator fill checks, freshness/entry-window checks, risk reservations, deduplication, trailing stops that do not loosen, retained exposure after rejected exits, protection after pausing and restart recovery of paper positions.

Its strict workflow excludes the manufactured analytical candle seed and uses a separate observed candle store. The REST/Yahoo fallback probe produced zero observer callbacks. It would be incorrect to claim that strict Daily Bot directly enters on that manufactured candle history. However, local observation is not independent certification of exchange history; real/test ticks share observer plumbing and quote provenance remains incomplete. Strategy/catalog/feed defects still apply. Use it for development and carefully interpreted paper testing.

**Meaning of “genuine” and “hallucination”**

Real calculations and paper execution coexist with invented values and unsupported success claims. “Verified”, “protected”, “confirmed”, “live” and displayed win rates cannot currently be taken at face value. Confidence 0.93 is not evidence of a 93% chance of winning. The configured daily earnings target is an aspiration rather than demonstrated income. This audit does not infer malicious intent or claim all project data is fake.

**Completion order before reassessing readiness**

1. Resolve false exit/fill/protection confirmations, missing-quote execution, owner authentication, shared arming and ambiguous broker outcomes.
2. Implement actual broker protocols and authoritative instruments, quantities/expiries, funding and field-level provenance.
3. Unify strategy entry/exit/timeframe logic, hash its configuration, correct P&L/drawdown/chronology and identify simulation/model output.
4. Persist the live intent/order/fill/protection/risk ledger; require successful broker reconciliation, account leadership and measured readiness.
5. Make production packages start/recover. Verify broker-format responses/packets and exercise rejections, partial fills, timeouts, protection failure, disconnects and restart during sustained paper/sandbox testing.
6. Validate strategy performance on actual option contract data with realistic costs and out-of-sample results before assessing whether an edge exists.

**Current decision: do not rely on this checkout to place or supervise real-money trades.** Improvements are confirmed, but data integrity, broker lifecycle, strategy and deployment failures keep the readiness verdict unchanged.
