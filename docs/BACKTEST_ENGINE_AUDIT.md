# Backtesting engine audit

Reviewed 11 October 2026 (Asia/Kolkata), against commit `b061edf3202fe81f45a21fe2bed76a4493cc810a` and the current workspace. Unrelated edits to `apps/api/src/main.ts`, `packages/client-sdk/src/client.ts` and its tests were left untouched. This audit adds documentation and isolated reproduction scripts; it does not fix production code.

**Decision: the engine is not production ready for evaluating real options trading performance.** It contains useful building blocks, but confirmed defects affect causality, strategy identity, risk limits, data coverage, execution and reported performance. Current backtest profits cannot establish whether a strategy is suitable for live trading. Even paper-trading comparisons require the parity fixes below.

## What was examined

The review traced the UI request, SDK, API strategy resolution, historical providers, indicator cache, AST evaluation, primary simulator, separate price-action momentum (PAM) simulator, optimization endpoint, charges, lot metadata, market calendar and relevant live execution rules. It included existing tests, controlled adversarial fixtures and current primary-source documentation. Provider fixtures were explicitly artificial and network requests were stubbed or denied. No owner credentials, broker balances or real orders were used.

There are two implementations:

| Path | Implementation | Important distinction |
| --- | --- | --- |
| Normal strategy/template backtest | `StrategiesService.runBacktest` → `runStrategyBacktest` | Evaluates AST rules on the previous candle and models option prices from index OHLC. |
| Dedicated PAM backtest/optimization | `PriceActionMomentumService` → `runPriceActionMomentumBacktest` | Implements efficiency/structure/breakout rules separately, with materially different fills and risk handling. The dedicated backtest HTTP route is currently shadowed; the optimization route still calls this engine. |
| PAM template through normal UI | Normal strategy/template path | Its AST contains a previous-high/low breakout, but does not implement all advertised PAM efficiency and structure requirements. |

## Genuine data, modeled data and invalid results

| Component | What the code actually does | Audit conclusion |
| --- | --- | --- |
| Historical underlying OHLC | Requests Upstox or Yahoo candles; unavailable providers cause an error. | A genuine provider path exists. A source label alone does not prove correct instrument, complete coverage or valid completed bars. |
| Synthetic historical generator | An explicitly named deterministic generator is used in test fixtures. | The production historical loader does not silently use this generator on provider failure (`backtest-engine.ts:268`). |
| Historical options | Both engines derive premiums from spot using an ATM premium of about 0.55% and fixed delta 0.5. | Prices, contract identity and fills are simulated. There is no historical options execution dataset in these paths. |
| Volume/VWAP | Zero-volume history is replaced with unit volume in the cache; some volume rules automatically pass. | This is an actual fabricated indicator input and a silent rule change, not genuine volume validation. |
| Charges | Deterministic estimates for two executed order legs. | Current principal rates match the broker documentation checked during this review. Historical schedules and contract-note accuracy are absent. |
| P&L, win rate, drawdown, profit factor | Derived from the above simulation and accounting. | These are model outputs, and several are incorrect even within that model. |

The main engine already returns a `MODELED_OPTIONS_ON_...` source and meaningful assumptions. The UI also has a correct general caution about index-only P&L. These are useful disclosures, but they do not repair the reproduced defects or validate a trading edge.

## Findings and fixes

Priority **P0** means a correctness blocker before using the affected results to make trading decisions. **P1** means necessary for dependable backtest/paper/live comparisons. **P2** means reporting, robustness or operational work that remains before a production-readiness claim. Priorities describe backtest reliability, not an assertion that a backtest itself places real orders.

### B01 — P0: future data changes earlier PAM trades

**Evidence:** `packages/domain/src/price-action-momentum.ts:404–406,556–560` builds five-minute candles from the entire dataset and passes the complete array at every historical evaluation. `:251–255` and `:164–167` use its final candles, including future sessions. The helper also treats any nonempty five-minute bucket as complete (`:132–133`).

**Reproduction:** a rising 20-minute prefix enters at **09:19 IST**. Append a declining future segment beginning **09:35 IST**, without changing the prefix, and that historical entry disappears; the first entry moves to **09:37 IST**. One input minute also produces one supposedly completed five-minute candle. The code comment claiming aggregation without lookahead is not supported by this behavior.

**Fix:** expose only candles whose close times are at or before the historical decision time. Aggregate incrementally, require complete contiguous minute coverage, enforce configured MTF lookback readiness, and hold partial buckets out. Add prefix-invariance tests: appending or editing future bars must never change earlier signals, orders or valuations before the appended data begins. Do not compare terminal forced exits across different endpoints in that invariant.

### B02 — P0: volume rules are bypassed and VWAP is invented

**Evidence:** `strategy-rule-evaluator.ts:85–89` substitutes volume 1 when the whole dataset has no positive volume. `:325–334` returns true for volume conditions when all candles have volume 0 or 1. Identification uses an indicator-ID substring (`includes('vol')`), rather than its declared type.

**Reproduction:** a rule requiring volume above 1,000,000 passes at volume zero. Appending only a future positive-volume candle changes the same past signal from true to false. A zero-volume VWAP prefix is reported as 10,000 instead of unavailable; appending future volume changes that earlier cached value to `NaN`. An EMA named `volatility_guard` also gets the volume bypass.

**Fix:** preserve missing volume as unavailable; reject volume-dependent strategies on datasets that cannot supply the required data. An optional time-weighted price indicator must have a distinct name and be explicitly selected. Resolve dependencies by indicator type. All availability decisions must be causal. Test zero, missing and genuine small volume, arbitrary IDs and future append invariance.

### B03 — P0: the API silently enlarges risk limits

**Evidence:** `apps/api/src/strategies/strategies.service.ts:370–395` uses `Math.max` to replace requested and saved limits with calculated minimums. It also increases round-trip cost budgets to at least ₹100. The stop calculation assumes every stop value is premium points regardless of its basis.

**Reproduction:** requested trade/day caps of **₹100/₹100**, saved caps of **₹200/₹600**, saved cost cap **₹60**, and a 10-point NIFTY stop are tested as **₹750/₹1,500** with a **₹100** cost cap. The stored strategy version is still used in the output.

**Fix:** preserve the tighter valid limits. If no exchange lot fits them, return a clear rejection or zero admissible trades with reasons. Resolve stop basis before calculating risk. If a user explicitly requests a hypothetical alternative risk profile, return its complete configuration and distinct run hash. Acceptance: the engine must never increase an explicit cap to obtain trades.

### B04 — P0: the PAM engine enters unfunded positions and breaches all-in caps

**Evidence:** `price-action-momentum.ts:354,580–604` always enters one lot, without checking capital, fee reserves or remaining daily loss allowance. It caps only gross stop distance and names the setting an all-in cap.

**Reproduction:** **₹1 initial capital** opens a trade requiring **₹3,592.55 premium**. Its ₹500 cap produces a **₹554.62 net stop loss** after ₹54.77 charges and a final balance of **−₹553.62**. The following gap is filled at the stop, which understates the gap loss further.

**Fix:** use the shared sizing/reservation policy; reserve premium, executable spread/slippage and fees before entry. Bound the full estimated loss by both per-trade and remaining daily allowances. Reject invalid capital/lot/tick inputs. Actual stop gaps may exceed a planned loss cap; report that honestly instead of guaranteeing a stop-price fill.

### B05 — P0: modeled index premiums cannot validate an options trading edge

**Evidence:** `backtest-engine.ts:21–23,56–59,107` and `price-action-momentum.ts:377,435–439,565–568` implement a fixed premium/delta model. Contract selection does not replay dated option listings, actual strikes, expiry, historical IV, theta, liquidity or bid/ask execution.

**Impact:** real index candles can coexist with unrealistic option profits. Holding-period decay, expiry behavior, changing delta, volatility and executable spreads can materially change the result. This is a disclosed model limitation, not evidence that the provider OHLC itself was randomly generated.

**Fix:** retain a clearly named underlying-signal research mode. For options performance, replay actual dated contracts and their historical option candles/quotes, with realistic fills. Resolve strike/expiry selection using information available on each decision date, preserve historical instrument metadata and define what happens when a contract has no executable data. Option OHLC improves price realism but still cannot establish intrabar order or bid/ask depth by itself.

Upstox documents an [expired-instrument candle API](https://upstox.com/developer/api-documentation/get-expired-historical-candle-data/) with historical option OHLC, volume and open interest; the documentation currently specifies Upstox Plus access. Availability for the desired dates and contracts must be checked rather than assumed.

### B06 — P0: the advertised PAM strategy is not the normal backtested strategy

**Evidence:** the PAM template descriptions promise efficiency and structure confirmation (`strategy-templates.ts:923,939,955`). Its AST conditions (`:940–964`) only check current close against the previous candle's high/low. The actual PAM efficiency/structure checks live separately at `price-action-momentum.ts:237–244,271–305`.

**Impact:** the normal UI can report a result for a strategy named Price Action Directional Momentum while evaluating a simpler breakout rule. The template's highest-high/lowest-low indicators affect warmup but are not referenced by its entry conditions. A strategy name and version are insufficient evidence of behavioral equivalence.

**Fix:** represent PAM's full rules in a supported canonical definition, or dispatch explicitly to one shared implementation. Compare normal backtest, dedicated evaluation and live/paper signals on the same causal replay. Rename a simpler breakout template if it is intentionally retained.

### B07 — P1: history outside 2026 silently returns zero trades

**Evidence:** `market-calendar.ts:87,95` recognizes only 2026. Both engines use this live permission calendar for historical execution (`backtest-engine.ts:88`; `price-action-momentum.ts:508`).

**Reproduction:** identical 20-bar always-long fixtures on 2025-10-06 and 2026-10-05 yield **0 trades/₹0/no error** and **1 trade/₹489.26/no error**, respectively.

**Fix:** supply authoritative historical session calendars for the requested years, including special sessions. Keep the live calendar permission guard distinct. Unsupported calendar coverage must be an explicit error, never a successful no-signal result. Validate every covered year before a run starts.

### B08 — P1: fetched, configured and reported candle intervals disagree

**Evidence:** `strategies.service.ts:368,391–413` fetches using the saved timeframe, while `BacktestRequestSchema` defaults an omitted timeframe to 5m (`schemas.ts:516`). The engine prefers that request timeframe (`backtest-engine.ts:18`). Actual spacing is not validated (`:34`). The loader changes unsupported intervals to 5m (`:152`).

**Reproduction:** saved 15m and an omitted timeframe produce an Upstox `minutes/15` request but a result labeled 5m. The final exit is stamped 08:35Z although the 15-minute bar closes at 08:45Z. A requested 3m loader interval becomes 5m. A separate 5m-input/15m-declared fixture creates overlapping reported trade timestamps.

**Fix:** resolve one effective timeframe before fetching and pass it everywhere. Reject unsupported intervals. Validate timestamps against session alignment and expected spacing; classify real gaps explicitly. The output must record both requested and observed interval, timestamp basis and data availability time.

### B09 — P1: incomplete historical coverage is accepted as success

**Evidence:** `backtest-engine.ts:206,259` accepts ten candles without checking requested session coverage. `:224` maps a 90-day Yahoo request to `range=60d`. Upstox receives a whole range without chunking (`:183–186`).

**Reproduction:** a 90-day request accepts 20 fixture candles spanning **95 minutes**. It does not identify the missing period. The returned candle bounds expose only what happened to arrive, not whether the request was fulfilled.

**Fix:** batch retrieval within provider limits, merge/deduplicate deterministically, and validate session-aware coverage. Return requested bounds, actual coverage, missing bars/sessions and a completeness status. Do not convert an incomplete dataset into an ordinary successful performance result.

The [Upstox V3 historical documentation](https://upstox.com/developer/api-documentation/v3/get-historical-candle-data/) specifies a one-month retrieval window for 1–15-minute intervals and a quarterly window for larger minute intervals. A 90-day 1m/5m request needs provider-aware batching.

### B10 — P1: FINNIFTY and MIDCPNIFTY use NIFTY candles

**Evidence:** `backtest-engine.ts:151,175` maps every underlying other than BANKNIFTY to Nifty 50. Saved strategies reach this path when the request omits underlying (`strategies.service.ts:367`). The explicit request enum instead rejects FIN/MID, so behavior also depends on the request shape.

**Reproduction:** both FINNIFTY and MIDCPNIFTY request `NSE_INDEX|Nifty 50`, while the result can retain the saved strategy's different underlying.

**Fix:** use a validated instrument mapping and return the resolved identity. Unsupported instruments must be rejected. Require consistency among requested underlying, strategy, provider instrument and historical contract metadata.

### B11 — P1: indicator warmup is discarded or silently insufficient

**Evidence:** date filtering precedes cache construction (`backtest-engine.ts:25–28,45`). A loader return count of ten is unrelated to a strategy's indicator readiness. Warmup failure produces no ordinary result diagnostic.

**Reproduction:** with 75 preceding bars and EMA30, the target day's first entry moves from **09:15 IST to 11:50 IST** when target-day date bounds discard the preceding history. Twenty bars with EMA30 produce zero trades and no error.

**Fix:** distinguish the data-loading window from the trading window. Preserve required warmup before the requested first decision; never permit trades during padding. Check indicator-specific readiness, including compounded indicators and confirmation offsets. Return `INSUFFICIENT_WARMUP` separately from genuine no-signal outcomes.

### B12 — P1: daily loss semantics differ from live execution

**Evidence:** `backtest-engine.ts:64,103,113,119` subtracts net daily P&L from the daily loss budget. Wins replenish this allowance. Live reservations accumulate losing fills separately (`apps/api/src/risk/risk-reservation.manager.ts:295`; `daily-bot-execution.service.ts:584`). The PAM engine uses net P&L and does not reserve remaining daily risk either.

**Reproduction:** a ₹300 daily cap permits **+₹593.07, −₹250.31, −₹250.31**: cumulative losing trades reach **₹500.62**. After the first loss, the live cumulative-loss policy has only ₹49.69 left.

**Fix:** select and document one loss definition, then share it across backtest, paper and live. Under the current live definition, wins cannot replenish the cumulative realized loss allowance. Include open risk reservations. Distinguish planned maximum loss from actual gap losses that can exceed it.

### B13 — P1: ignored out-of-session bars can create final exits

**Evidence:** main execution skips closed-market candles (`backtest-engine.ts:88`), but final settlement uses the last supplied candle (`:127`). Day rollover similarly uses the previous input candle (`:85`). PAM has analogous final/rollover settlement (`price-action-momentum.ts:499–501,611–614`).

**Reproduction:** append a skipped **15:35 IST** candle with spot 11,000 to flat spot-10,000 history. The primary engine exits at modeled **₹554.95 at 15:40 IST**, reports **₹32,375.41 profit**, and bypasses its ₹65.05 target.

**Fix:** value and settle positions only with eligible, completed execution data. Track the last eligible bar separately. Define session-end and incomplete-session handling explicitly; do not conceal missing cutoff data behind an arbitrary final price.

### B14 — P1: maximum drawdown omits open-position losses

**Evidence:** `backtest-engine.ts:65` and `price-action-momentum.ts:459–462` update peaks/drawdown only on settlement.

**Reproduction:** a ₹10,000 account's closed-bar liquidation equity falls to **₹9,743.19**, then the position finishes with **₹910.95 profit**. Reported maximum drawdown is **₹0/0%**.

**Fix:** track cash, inventory and liquidation-value equity at every decision bar, including estimated exit costs. Calculate drawdown from that series. If retained, the existing metric must be named closed-trade balance drawdown. Add an equity curve and test the ₹256.81 interim decline. Intrabar worst-case risk should remain a separately disclosed estimate if only OHLC is available.

### B15 — P1: backtest position sizing and execution gates differ from live

**Evidence:** main backtest uses all affordable lots (`backtest-engine.ts:109–119`), while the runtime evaluator proposes one lot (`strategy-evaluator.ts:109`). The main model reserves two ticks; runtime reserves 2% (`strategy-evaluator.ts:111`). Runtime also rejects nonpositive net targets (`:123`).

**Reproduction:** ₹10,000 can buy **130 units** in backtest where runtime proposes **65**. At entry ₹55.05, spread/slippage reserves are **₹6.50** versus **₹71.56** per lot. A ₹200 cap accepts the simulated trade but rejects the comparable runtime proposal. A 0.10-point target is labeled `TARGET_PROFIT` despite **₹6.50 gross, ₹55.71 charges and −₹49.21 net**.

**Fix:** use shared sizing and financial gates, with explicit execution profiles if assumptions differ intentionally. Enforce target net viability where required by the live strategy. Replay the same snapshots through paper/backtest/live policies and compare quantity, admissibility and risk reservations; price-model differences must be separately recorded.

### B16 — P1: accepted strategy settings silently do nothing

**Evidence:** main trailing reads activation and gap (`backtest-engine.ts:51–52,76–79`) but ignores `profitLockInr`, `adjustmentStepInr` when a gap is set, and `adjustmentFrequencyBars` supported at `schemas.ts:408–430`. Main entries do not implement every accepted entry setting. Contract spread, OI, expiry and other selection settings have no historical options dataset on which to operate.

**Reproduction:** lock=150/step=1,000/frequency=10 and lock=1/step=1/frequency=1 produce the same **₹57.40 trailing stop/₹96.76 net exit**. The runtime Daily Bot uses a distinct trailing net-lock policy (`daily-bot-execution.service.ts:458`). Reentry semantics also differ: main resets permission after a signal wave ends, while Daily Bot forbids another trade after its first closure when `allowReentry=false` (`:611`).

**Fix:** publish an executable capability matrix. Implement settings with shared semantics, or reject them and clearly explain why required data is unavailable. Do not silently treat configured constraints as satisfied. Include tests where each material setting changes a carefully chosen fixture's result or returns an explicit unsupported-setting error.

### B17 — P1: PAM ignores percentage exits, session settings and contract selection

**Evidence:** `price-action-momentum.ts:571–589` handles structure-based stops specially, but percentage values fall through as points; only risk-reward targets get special handling. Session start/last-entry/cutoff are not enforced by its loop; moneyness/strike offset do not affect the modeled contract. Its trailing activation at `:534–539` uses gross profit although the variable is named `unrealizedNet`.

**Reproduction:** changing fixed-point exits to percentage exits, ATM to OTM with offset 5, and the session to **12:00–12:01 IST** leaves the complete trade history unchanged, including an entry at **09:19 IST**. The default declared start is already 09:25 IST.

**Fix:** implement every accepted option consistently, or reject unsupported ones. Calculate percentage exits from entry premium and use fees in net-profit activation. Enforce entry/cutoff rules and elapsed-time cooldown on completed causal bars. Gap/missing-minute fixtures must not mistake a bar count for minutes.

### B18 — P1: missing indicators can become a true NOT signal

**Evidence:** missing/invalid operand values return false (`strategy-rule-evaluator.ts:304–305,337–338`), then NOT converts that result into true (`:455–462`). Shape validation does not guarantee reference integrity or indicator readiness. An optional API AST validation method checks references (`strategies.service.ts:160–220`), but the backtest and save paths do not automatically invoke it.

**Reproduction:** a schema-accepted NOT group referencing a nonexistent indicator yields a bullish signal. Invalid data is therefore usable as affirmative evidence.

**Fix:** validate every reference, field and required parameter before a run. Evaluate unavailable data with an explicit `UNKNOWN` state, which must remain nontradable even beneath NOT. Test missing references, NaN indicator values and nested logical groups.

### B19 — P1: indicator input configuration can be ignored

**Evidence:** RSI always reads closes (`strategy-rule-evaluator.ts:77–79`); Bollinger Bands and MACD likewise use closes despite generic source configuration (`:94–109`). `resolveOperandValue` treats a multiplier of zero as absent (`:252,308`), and unknown candle fields fall back to close (`:288–289`).

**Reproduction:** RSI configured with falling open prices and rising closes returns **100**, while the requested open-price RSI is **0**. A zero multiplier resolves to the original operand rather than zero.

**Fix:** route supported indicators through the declared source; reject unsupported source/field combinations. Use explicit undefined checks for multipliers. Invalid fields must fail validation instead of silently selecting close. Reference indicator calculations against independent known values.

### B20 — P1: the dedicated PAM backtest route is shadowed

**Evidence:** `strategies.controller.ts:67` declares generic `POST :id/backtest` before the static `POST price-action-momentum/backtest` at `:82`.

**Reproduction:** registering actual controller route metadata into an in-process Express router matches `/strategies/price-action-momentum/backtest` to `runBacktest` with ID `price-action-momentum`, rather than the dedicated PAM method. This is a routing reproduction without starting a server; no deployed-instance routing was tested.

**Fix:** declare static routes first, preferably give specialized engines a distinct namespace. Add a Nest HTTP integration test proving which service handles each route. Repairing routing alone exposes the PAM correctness problems; it does not repair them.

### B21 — P2: known opening prices are handled as ambiguous intrabar paths

**Evidence:** `backtest-engine.ts:73–74` checks the whole-bar low before the target, even if the bar opens above an already resting target.

**Reproduction:** modeled opening bid **₹74.95** is already above target **₹65.05**, then the same candle falls through stop **₹53.05**. The engine reports **−₹185.44 STOP_LOSS**. Conservative execution at the target at the known opening time would yield **+₹593.07** in this fixture.

**Fix:** process opening gaps and eligible resting orders before unknown intrabar crossings. Use stop-first only for genuinely ambiguous paths after the open; provide alternative-path sensitivity or finer data. The PAM engine must also fill stop gaps from the executable opening price rather than guaranteeing the stop. Specify order activation times explicitly.

### B22 — P2: fill prices and recorded accounting disagree

**Evidence:** main entry rounding is to two decimals (`backtest-engine.ts:107`), not tick size. Settlement computes P&L using a precise price then records a rounded price (`:62–66`). `strategy-evaluator.ts:70–80` can round a tiny stop distance back to entry without revalidating the levels. PAM also rounds to cents, not ticks.

**Reproduction:** spot 22,523 yields entry **₹123.93** on a ₹0.05 tick grid. Recorded exit **₹124.50** implies gross **₹37.05**, but the trade records **₹36.82**. An entry ₹55.05 with stop distance ₹0.01 rounds the stop to **₹55.05** and is accepted by the core; Daily Bot rejects stop ≥ entry.

**Fix:** round executable fills to ticks before calculating charges and P&L; store those exact fill prices. Require `0 < stop < entry < target` after rounding. Use a documented decimal/currency policy. Every trade record must independently reconstruct its gross, charges and net result within the specified rounding tolerance.

### B23 — P2: timing, candle completeness and validation are inconsistent

**Evidence:** loaders filter on candle opening timestamp (`backtest-engine.ts:200–202,239–242`), not completion. Main intrabar exits are timestamped at candle close regardless of when triggered (`:71–74`); PAM uses current close for a signal/entry but records the candle opening timestamp (`price-action-momentum.ts:560,566,593`). PAM does not validate duplicate/invalid OHLC or metadata before simulation. Main converts timestamps to ISO before invalid-timestamp validation (`backtest-engine.ts:29,34`).

**Reproduction:** a 04:05–04:10Z bar is accepted at mocked current time **04:07Z**. PAM's timestamps imply availability one minute before its close-based decision. Some existing PAM backtest fixtures themselves have invalid OHLC, so passing those tests does not establish data validation.

**Fix:** capture a run cutoff once, exclude unfinished bars, and define open/close/available timestamps explicitly. Close-based signals should create eligible orders at a subsequent executable event, or disclose a carefully modeled market-on-close policy. Return unknown intrabar execution times honestly. Validate all inputs before conversion/simulation; reject duplicates, nonfinite data and invalid OHLC with structured errors.

### B24 — P2: profit factor is wrong or invented in edge cases

**Evidence:** `backtest-engine.ts:129–130` returns zero if there are no losing trades. `price-action-momentum.ts:628` returns the invented sentinel 99.99 for all winners.

**Reproduction:** one primary-engine winner of **₹593.07**, no losing trades, reports **profitFactor=0**.

**Fix:** define whether the metric uses gross or net trade P&L and share that calculation. When the denominator is zero, return a nullable metric plus a reason such as `NO_LOSING_TRADES` or `NO_TRADES`. Do not serialize JSON infinity or use an unexplained finite sentinel. Distinguish breakeven trades from losses if the chosen reporting policy needs that distinction.

### B25 — P2: provider failures, dates and fallbacks lack a reliable contract

**Evidence:** dates are arbitrary strings (`schemas.ts:514–515`), then sliced (`backtest-engine.ts:162–163`). IST midnight becomes a UTC date for provider paths (`:165,177`). Fetches have no explicit abort signal/deadline (`:183–186,228`); errors are discarded before fallback (`:211–213,264–265`). `preferUpstox:true` attempts an authenticated endpoint without a token when none is available.

**Reproduction:** `2026-10-05junk` is accepted. A custom October 5 request sends Upstox October 4 as its from-date. Local filtering excludes the extra day, but retrieval-window boundaries can still be affected. Probes observed no abort signal. A fallback provider is named in the main output, but the reason for falling back is lost.

**Fix:** validate strict real calendar dates, order and bounded duration; format provider dates in the intended market timezone. Use authenticated provider requests deliberately. Implement bounded timeouts, retryable-error classification and rate-limit handling. Record fallback diagnostics and let runs require a particular source when provider consistency matters. Use the [documented current-day intraday endpoint](https://upstox.com/developer/api-documentation/v3/get-intra-day-candle-data/) when appropriate.

### B26 — P2: results cannot be reproduced from a run manifest

**Evidence:** `BacktestResultSchema` (`schemas.ts:529–553`) has a strategy version and source string but no immutable configuration snapshot, data fingerprint, provider instrument, observed interval, model version, fee version or completeness report. API request/risk overrides can change effective behavior while retaining the same strategy version. The PAM service drops the fetched dataSource (`price-action-momentum.service.ts:224–244`) and returns a generic engine label instead.

**Fix:** persist a run ID with code/engine version, complete effective strategy and request, strategy/run hashes, dataset hash and immutable data reference, provider instrument, timestamps, requested/covered bounds, missing data, metadata/fee versions, seed when applicable, equity series and rejection counts. An identical manifest must replay identical decisions and accounting. Store provider failure details without credentials.

### B27 — P2: historical fee and contract metadata are missing

**Evidence:** current reference lots are applied to all periods (`lot-size.ts:13–18`; API passes no historical lot/tick series). `charges.ts:42–58` applies one fee schedule and assumes one executed buy and sell order. It has no trade-date or executed-order-count parameter.

**Finding:** this review verified the principal current rates in the [Upstox charges documentation](https://upstox.com/brokerage-charges/): ₹20 per executed options order, 0.15% sell-premium STT from April 2026, and 0.03553% NSE option transaction charges from March 2026. The same page lists earlier schedules. Correct current estimates do not establish exact historical charges.

**Fix:** attach dated lot/tick/expiry metadata to actual contracts and use effective-date fee schedules. Account for actual modeled executed orders, rounding and exercise/expiry behavior if positions can survive expiry. Reconcile controlled examples against broker contract notes. Keep estimated and broker-actual charges distinct.

### B28 — P2: UI choices and displayed assumptions can mislead

**Evidence:** UI underlying/timeframe controls (`apps/trader/app/strategies.tsx:1111,1131`) are superseded by the selected strategy in the request (`:192–204`). Labels say NIFTY25/BANK15 (`:1122–1123`), while modeled lots are65/30. Daily candles are selectable (`:1146`) but the engine rejects them. `modelAssumptions` is never rendered; trailing status reflects UI controls rather than an effective run manifest (`:1530–1533`).

**Fix:** honor explicit overrides or lock controls with a clear explanation. Render effective configuration and dated lot metadata from the result. Show modeled-P&L assumptions next to profit/drawdown, along with data completeness and rejected-trade reasons. A zero-trade result must distinguish no signals, insufficient warmup, calendar/data unavailability and financial rejections. The existing source badge and caution paragraph should be retained.

### B29 — P2: optimization has no out-of-sample validation

**Evidence:** `PriceActionMomentumService.runParameterOptimization` (`:254–297`) runs 32 parameter combinations on the same candles and sorts by that dataset's net P&L. Half enable the currently noncausal MTF implementation. There is no held-out evaluation or trial-count adjustment in this path.

**Fix:** repair causality first. Separate chronological development, selection and untouched test periods; run rolling walk-forward evaluation with warmup handled causally. Preserve all attempted configurations, evaluate parameter stability and realistic cost/slippage stress, and report confidence intervals from adequately supported observations. Do not label the largest in-sample profit a verified best strategy. The [original probability-of-backtest-overfitting paper](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) explains why selecting the best historical result can degrade out-of-sample performance.

### B30 — P2: execution lacks bounded jobs and run diagnostics

**Evidence:** historical fetching and simulation run within request handlers (`strategies.service.ts:398–413`; `price-action-momentum.service.ts:269–297`). Custom date ranges and supplied optimization candle arrays have no engine-level maximum size. Zero-volume checks scan the whole dataset for each evaluated condition (`strategy-rule-evaluator.ts:331`), adding avoidable work to long runs. These source findings were not load-benchmarked.

**Fix:** bound data sizes/ranges, request duration and concurrency. Run CPU-heavy backtests outside the live execution event loop, with cancellation and progress if jobs are long. Cache validated dependency metadata rather than rescanning future data. Log run IDs, coverage, rejected trades and failures. For personal use, a simple bounded worker and local durable runs can suffice; a large distributed platform is not a prerequisite.

### B31 — P1: predefined stops do not fit their own declared budgets

**Evidence:** predefined stop values and declared caps in `strategy-templates.ts` are not feasible at the current reference lots. Examples: stop/cap at `:128/:150`, `:359/:381`, `:475/:497`, `:609/:631`, `:756/:778`, and `:888/:910`. The roadmap test permits zero executed trades (`strategy-roadmap-validation.spec.ts:196–209`), so its use of the word calibrated does not demonstrate a feasible or profitable configuration.

| Template | Gross stop risk at one reference lot | Declared cap | Fixture loss including fees/spread |
| --- | ---: | ---: | ---: |
| NIFTY trend | 8 × 65 = ₹520 | ₹300 | ₹581.20 |
| BANKNIFTY crossover | 12 × 30 = ₹360 | ₹400 | ₹426.32 |
| NIFTY RSI reversal | 7 × 65 = ₹455 | ₹200 | ₹516.31 |
| NIFTY VWAP momentum | 8 × 65 = ₹520 | ₹200 | ₹581.20 |
| NIFTY ORB | 9 × 65 = ₹585 | ₹250 | ₹646.06 |
| NIFTY Bollinger | 8 × 65 = ₹520 | ₹200 | ₹581.20 |
| NIFTY bearish panic | 10 × 65 = ₹650 | ₹400 | ₹710.94 |

The six NIFTY configurations fail on gross stop risk alone. For BANKNIFTY, even ₹360 plus the calculator's ₹47.20 minimum brokerage/GST exceeds ₹400. The fixture totals illustrate one modeled price environment; they are not empirical strategy calibration. The API's automatic cap increase hides rather than solves this incompatibility.

**Fix:** validate contract-specific stop/cost/capital feasibility when a strategy is saved or tested. Within the user's unchanged caps, either design and independently validate a suitable stop or reject the configuration with the minimum admissible risk calculation. A stop should not be arbitrarily tightened merely to force a trade. Default examples need documented feasible operating conditions and fixtures that actually exercise them.

### B32 — P1: legacy conversion changes the strategy's meaning

**Evidence:** `convertLegacyStrategyToAst` hardcodes bullish direction and LONG_CE selection (`strategy-rule-evaluator.ts:542,586`), ATM strike selection (`:589`) and option-premium exit basis (`:597`) even when legacy settings express something else.

**Reproduction:** a put-only legacy configuration converts to a bullish/CE AST; the later allowed-instrument check can suppress every entry. An `UNDERLYING_LEVEL` legacy stop converts to an option-premium stop. These conversions do not preserve the original strategy's units or direction.

**Fix:** migrate supported legacy meanings explicitly and retain unit semantics. Reject unsupported or ambiguous legacy configurations instead of guessing bearish entry rules or reinterpreting underlying values. Include conversion round-trip and signal/exit equivalence tests; a successful schema parse alone cannot establish semantic equivalence.

### B33 — P1: a cutoff inside a coarse candle is not faithfully enforced

**Evidence:** the main loop checks cutoff against candle opening time (`backtest-engine.ts:99`), then evaluates that candle's full high/low and uses its closing timestamp (`:71–74`).

**Reproduction:** a 14:45–15:00 candle with a mandatory **14:50 cutoff** returns `TARGET_PROFIT` at **15:00**, ten minutes after cutoff. The OHLC does not establish whether the target occurred before 14:50.

**Fix:** use finer execution data across cutoffs, or reject/disclose a conservative resolution policy when cutoff splits a bar. Apply analogous policies to last-entry time, session end and any timed exit. A simulated cutoff must not imply execution at a time for which the data supplies no price.

### B34 — P2: request defaults and supplied edits do not have clear precedence

**Evidence:** `BacktestRequestSchema` supplies trailing enabled=true, activation=150 and step=50 (`schemas.ts:519–521`), and the engine prioritizes them over saved AST settings (`backtest-engine.ts:42,51–52`). The API applies a submitted strategy to templates (`strategies.service.ts:353`), but loads the saved strategy for an existing ID (`:357`) without applying or explicitly rejecting the submitted strategy snapshot.

**Reproduction/source finding:** an otherwise empty parsed request enables trailing even when the AST disables it. The existing-ID branch also ignores a supplied edited strategy; this branch was verified by source inspection rather than a UI interaction test.

**Fix:** distinguish omitted overrides from explicit values. Resolve and return a documented effective configuration once. For existing strategies, either test an explicitly supplied validated draft as a separate immutable run or require a matching saved version/hash. Tell the user which snapshot was used; do not silently test an older saved definition.

## What is already useful

The main simulator evaluates previous-bar rules before next-bar entries; explicitly labels its price model; charges trades rather than claiming free execution; checks basic OHLC validity, duplicates, capital and lot/tick values; blocks unsupported daily/mixed-timeframe/futures/reversal combinations; prevents same-bar reentry; uses an established stop before trailing updates; adjusts stop fills for opening gaps; and includes dataset-end settlements in realized drawdown. The AST, fee calculator and existing strategy hashing provide a workable foundation for a corrected shared engine.

These strengths do not establish predictive accuracy. Some behavior is intentionally conservative, such as stop-first ambiguous OHLC handling, but a conservative model still needs correct chronology, known-open handling and honest limitations. The [QuantConnect fill-model documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/trade-fills/supported-models/equity-model) illustrates explicit data availability, opening-gap fills, regular-session execution and order-activation constraints; it is a useful reference, not an assertion that its equity model can be copied unchanged for Indian options.

## Required repair sequence and acceptance criteria

1. **Repair decision integrity:** eliminate both future-data dependencies and invented volume; validate AST references; make PAM strategy identity consistent; preserve explicit risk/cost caps; reject unfunded entries. Acceptance: future append/edit tests preserve earlier decisions, missing data never proves a trade, and no admission enlarges a configured budget.
2. **Repair historical inputs:** support dated calendars, one effective interval/instrument, complete provider batching and causal warmup. Acceptance: known sessions from multiple years replay correctly; incomplete bars/history and unsupported instruments/settings return explicit outcomes.
3. **Unify execution/accounting with paper/live:** share sizing, risk reservations, exits, reentry and trailing policies; fix gap/tick/timing/accounting; keep realistic model differences explicit. Acceptance: the same causal snapshots produce the same admissibility, quantities and intended order logic; ledger reconstruction and marked-to-market equity reconcile.
4. **Build an actual options performance path:** dated contract selection and historical option prices/quotes, source coverage, effective fee schedules and realistic liquidity/spread assumptions. Acceptance: manual small-dataset replays and controlled broker-paper observations agree within documented modeling limits. Costs and unfavorable execution stress must be included.
5. **Make results reviewable and repeatable:** run manifests, equity, data/rejection diagnostics and correct edge-case metrics. Acceptance: an immutable run replays identically and the UI displays the effective settings and limitations.
6. **Validate strategy quality independently:** chronological holdout and walk-forward evaluation, parameter sensitivity, uncertainty and paper/live reconciliation. Acceptance depends on the chosen strategy and data; no universal trade count or win-rate threshold proves readiness or profitability.
7. **Bound operational work:** isolate long simulations, cap resources and exercise failure/cancellation paths. Acceptance: a backtest cannot starve the API process that manages positions. This audit did not certify deployment availability or broker compliance.

## Verification and reproducible evidence

**Existing targeted tests:** 67 passed across eight files (55 domain tests and 12 API tests):

- `packages/domain/src/__tests__/backtest-engine.spec.ts` — 6
- `packages/domain/src/__tests__/strategy-integrity.spec.ts` — 13
- `packages/domain/src/__tests__/strategy-ast.spec.ts` — 7
- `packages/domain/src/__tests__/strategy-evaluator.spec.ts` — 7
- `packages/domain/src/__tests__/strategy-roadmap-validation.spec.ts` — 5
- `packages/domain/src/__tests__/price-action-momentum.spec.ts` — 17
- `apps/api/src/__tests__/agents-and-strategies.spec.ts` — 9
- `apps/api/src/__tests__/price-action-momentum.spec.ts` — 3

This was a focused backtesting audit, not a production build/deployment certification. Passing tests miss the reproduced failures. For example, the trailing backtest test checks a defined source and a trade count ≥0, which cannot validate trailing behavior; some template tests allow every template to return zero trades; the direct VWAP integrity test misses the cache's volume substitution.

**Broader workspace test run:** while verifying the audit runner, the initial merged configuration also selected the normal suite. That run completed with **398 passing and 1 failing test across 41 files**, including the six audit observations. The failure was `packages/client-sdk/src/__tests__/daily-bot.spec.ts:57`: expected the old `API error 409 on ...` text but received `A daily bot is already running (409)`. SDK source/tests were changing separately during this review and were preserved; this error-message assertion was not fixed as part of the engine audit. The runner was corrected to isolate audit observations; its subsequent run selected exactly one file and reproduced all six observations. No full-project green result is claimed.

**Audit observations:** six additional Vitest probes reproduce future-MTF leakage, unfunded/cap-breaching PAM entries, ignored PAM settings, incomplete MTF buckets, API risk overrides and timeframe divergence. They assert the observed defective behavior so the findings are reproducible; passing them is not a correctness certificate. Convert them to correct-behavior regression tests when fixing the engine. Further source/provider/routing/accounting probes are retained alongside them.

```sh
pnpm exec vitest run --config docs/audit/vitest.config.ts --maxWorkers=1 --minWorkers=1
pnpm exec tsx docs/audit/execution-backtest-audit.mts
node --import tsx docs/audit/historical-data-probe.mts
TSX_TSCONFIG_PATH=apps/api/tsconfig.json node --import tsx docs/audit/historical-api-probe.mts
node --import tsx docs/audit/strategy-backtest-audit.mts
```

The scripts use artificial fixture candles and local provider stubs. Their profitable and losing examples are demonstrations of engine behavior, never performance claims. In particular, a simulated future fixture date does not claim that market data for that date already exists. Inspect [the evidence directory](audit/) for full fixtures and commands.

**Practical decision:** use the current output only for inspecting modeled rule behavior while these defects are visible. Do not use its profits, drawdown, win rate or optimization ranking to choose a real-money strategy. Personal ownership reduces deployment complexity; it does not remove the correctness requirements above. A sound engine and a profitable strategy are separate achievements, and neither has been established by this review.
