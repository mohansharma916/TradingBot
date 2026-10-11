# F&O Strategy Roadmap
**Platform:** AI F&O Trading Bot — NIFTY / BANKNIFTY / MIDCPNIFTY  
**Based on:** `docs/deep-research-report.md` (2016–2025 backtest research)  
**Version:** October 2026

---

## Platform Constraints (Non-Negotiable)

Before any strategy design, these hard limits govern every configuration:

| Constraint | Value | Source |
| :--- | :--- | :--- |
| **Allowed instruments** | `LONG_CALL`, `LONG_PUT` only | `AllowedOptionType` enum — no selling |
| **Max open positions** | 1 per strategy | `maxOpenPositions` |
| **Max capital per trade** | ₹10,000 – ₹30,000 | `maxCapitalInr` |
| **Max loss per trade** | ₹200 – ₹500 | `maxAllInTradeLossInr` |
| **Max daily loss** | ₹600 – ₹1,000 | `maxAllInDailyLossInr` |
| **Daily profit target** | ₹300 – ₹800 | `targetNetProfitInr` |
| **Round-trip cost budget** | ₹60 – ₹100 | `maxRoundTripCostBudgetInr` |
| **Requires human approval** | `true` always (Paper + Live both) | `requiresApproval` |
| **Min option premium** | ₹25 – ₹50 | `contractSelection.minPremium` |
| **Max option premium** | ₹400 – ₹600 | `contractSelection.maxPremium` |
| **Max bid-ask spread** | 1.0% – 1.5% | `contractSelection.maxBidAskSpreadPct` |
| **Candle close confirmation** | Required on every strategy | `entryRules.candleCloseConfirmation: true` |
| **Market cutoff** | 15:00 – 15:10 IST | `exitRules.marketCutoffTime` |

> **Selling strategies** (Short Straddle, Short Strangle, Iron Condor, Credit Spreads) from the research report are **excluded** from this roadmap. The platform only supports options buying (long gamma). Selling strategies require margin, carry unlimited risk, and need a different risk engine.

---

## Strategy Overview Matrix

| # | Strategy Name | Category | Underlying | Timeframe | Win Rate (Research) | Risk:Reward | Priority |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| S1 | Triple Confirmation Trend | TREND | NIFTY | 5m | ~55–60% | 1:2.5 | ⭐ Phase 1 |
| S2 | VWAP Institutional Surge | MOMENTUM | NIFTY | 5m | ~55–65% | 1:2 | ⭐ Phase 1 |
| S3 | Opening Range Breakout | BREAKOUT | NIFTY/BANKNIFTY | 5m | ~50–60% | 1:2 | ⭐ Phase 1 |
| S4 | EMA Crossover + Volume | MOMENTUM | BANKNIFTY | 5m | ~50–55% | 1:2 | 🔵 Phase 2 |
| S5 | Bollinger Squeeze Breakout | BREAKOUT | NIFTY | 5m | ~50–60% | 1:2.5 | 🔵 Phase 2 |
| S6 | RSI Exhaustion Reversal | MEAN_REVERSION | NIFTY | 5m | ~45–55% | 1:2 | 🔵 Phase 2 |
| S7 | Bear Panic Detector (Put Buy) | TREND | NIFTY/BANKNIFTY | 5m | ~45–55% | 1:3 | 🟡 Phase 3 |

> Note: Win rates for options buying are lower than the research report's selling strategies. This is expected and acceptable — the edge comes from **asymmetric payoff** (large winners, small losers).

---

## Strategy Definitions

---

### S1 — Triple Confirmation Trend
**Category:** TREND  
**Direction:** BOTH (CE on uptrend, PE on downtrend)  
**Timeframe:** 5m

**Why this strategy?**
The research report confirms that EMA + VWAP multi-confirmation systems achieve the best Sharpe ratios (~1.6–1.8) in directional markets. For a Long Options buyer, this is the cornerstone strategy: it only fires in strong trends where premium expansion covers cost.

**Entry Logic:**
- **CE (Call Buy):** EMA 20 > EMA 50 **AND** Close > VWAP **AND** RSI > 55
- **PE (Put Buy):** EMA 20 < EMA 50 **AND** Close < VWAP **AND** RSI < 45

**Risk Calibration:**
| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Capital | ₹15,000 | ~2 lots NIFTY ATM at ₹100–120 premium |
| Max trade loss | ₹300 | ≈ 8 pts SL × 2 lots × 75 qty / lot |
| Max daily loss | ₹600 | 2 losing trades limit |
| Profit target | ₹500 | 20 pts target × 2 lots × 75 qty |
| SL (premium pts) | 8 pts | Per option |
| Target (premium pts) | 20 pts | 1:2.5 RR |
| Trailing activation | ₹150 | Lock in after ₹150 gain |
| Trailing gap | ₹60 | Never give back more than ₹60 of open profit |

**Entry Rules:**
- `candleCloseConfirmation: true`
- `confirmingCandles: 1` (one confirmed candle close before entry)
- `cooldownBars: 2` (2-bar wait after any trade)
- `allowReentry: false`

**Session:** 09:25 → lastEntry: 14:45

**Indicators:** EMA(20, close), EMA(50, close), VWAP, RSI(14, close)

**Contract Selection:** ATM, NEAREST_ELIGIBLE expiry, minPremium: 30, maxPremium: 500, maxBidAsk: 1.5%

**Existing Template:** `tpl_trend_following` (already in `strategy-templates.ts`) — modify defaults only

---

### S2 — VWAP Institutional Surge
**Category:** MOMENTUM  
**Direction:** BOTH  
**Timeframe:** 5m

**Why this strategy?**
Research shows institutional order flow around VWAP creates the most reliable intraday breakouts. A volume surge (1.5× average) on VWAP cross signals genuine institutional participation — not a fake out.

**Entry Logic:**
- **CE (Call Buy):** Close **CROSSES_ABOVE** VWAP **AND** current volume > 1.5× 20-bar avg volume
- **PE (Put Buy):** Close **CROSSES_BELOW** VWAP **AND** current volume > 1.5× 20-bar avg volume

**Risk Calibration:**
| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Capital | ₹12,000 | Smaller — breakout signals can fail at VWAP re-tests |
| Max trade loss | ₹200 | Tight — if VWAP rejects immediately, cut fast |
| Max daily loss | ₹600 | 3 losing trades allowed |
| Profit target | ₹400 | 16 pts target × quantity |
| SL (premium pts) | 8 pts | |
| Target (premium pts) | 16 pts | 1:2 RR |
| Trailing activation | ₹150 | |
| Trailing gap | ₹50 | |

**Session:** 09:25 → lastEntry: 14:30 (VWAP signals lose reliability late day)

**Existing Template:** `tpl_vwap_momentum` (already exists) — tune session + capital

---

### S3 — Opening Range Breakout (ORB)
**Category:** BREAKOUT  
**Direction:** BOTH  
**Timeframe:** 5m  

**Why this strategy?**
The research notes that >60% of intraday trend days are established within the first 30–45 minutes. ORB is one of the most backtested and validated strategies in Indian markets. The platform already has `OPENING_RANGE_HIGH` and `OPENING_RANGE_LOW` indicator types.

**Entry Logic:**
- **CE (Call Buy):** Close > Opening Range High (09:15–09:30 session) **AND** Volume > 10-bar avg
- **PE (Put Buy):** Close < Opening Range Low (09:15–09:30 session) **AND** Volume > 10-bar avg

**Additional Filter (add in implementation):**
- EMA 20 must be in the direction of the breakout (EMA 20 > EMA 50 for CE, < EMA 50 for PE)
- This eliminates fake ORB breaks against the established trend

**Risk Calibration:**
| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Capital | ₹12,000 | ORB is a morning-only strategy |
| Max trade loss | ₹250 | 9 pts SL |
| Max daily loss | ₹600 | |
| Profit target | ₹450 | 18 pts target |
| SL (premium pts) | 9 pts | Slightly wider than trend — opening volatility |
| Target (premium pts) | 18 pts | 1:2 RR |
| Trailing activation | ₹150 | |
| Trailing gap | ₹50 | |

**Session:** 09:30 → lastEntry: 11:30 (morning only — ORB signal expires by noon)

**Existing Template:** `tpl_opening_range_breakout` — already exists, add EMA trend filter

---

### S4 — EMA Crossover with Volume Confirmation
**Category:** MOMENTUM  
**Direction:** BOTH  
**Underlying:** BANKNIFTY (higher beta = more premium movement per point)  
**Timeframe:** 5m

**Why this strategy?**
The research shows EMA crossovers work best on high-volatility instruments. BANKNIFTY's larger swings mean ATM option premiums move 2–3× more per index point vs NIFTY, making the same crossover signal more profitable for option buyers.

**Entry Logic:**
- **CE (Call Buy):** EMA(9) **CROSSES_ABOVE** EMA(21) **AND** Volume > 20-bar avg
- **PE (Put Buy):** EMA(9) **CROSSES_BELOW** EMA(21) **AND** Volume > 20-bar avg

**Risk Calibration (BANKNIFTY — wider premiums):**
| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Capital | ₹20,000 | BANKNIFTY lot size = 30 qty, premiums higher |
| Max trade loss | ₹400 | 12 pts SL × 30 qty |
| Max daily loss | ₹800 | |
| Profit target | ₹700 | 25 pts target × 30 qty |
| SL (premium pts) | 12 pts | BANKNIFTY needs wider SL |
| Target (premium pts) | 25 pts | ~1:2 RR |
| Trailing activation | ₹200 | |
| Trailing gap | ₹80 | |

**Session:** 09:25 → lastEntry: 14:30  
`cooldownBars: 3` (reduce whipsaw on EMA cross signals)  

**Existing Template:** `tpl_ema_crossover` — clone, change underlying to BANKNIFTY, update capital/SL

---

### S5 — Bollinger Squeeze Breakout
**Category:** BREAKOUT  
**Direction:** BOTH  
**Underlying:** NIFTY  
**Timeframe:** 5m

**Why this strategy?**
The research report highlights that volatility compression (low ATR, Bollinger Band squeeze) preceding a breakout is a high-probability setup. When price breaks outside the 2σ Bollinger Bands WITH expanding ATR, it signals a genuine momentum expansion — ideal for long options which benefit from both directional move AND IV expansion.

**Entry Logic:**
- **CE (Call Buy):** Close > Upper BB(20, 2σ) **AND** ATR(14) **INCREASING**
- **PE (Put Buy):** Close < Lower BB(20, 2σ) **AND** ATR(14) **INCREASING**

**Additional Enhancement (Phase 2 implementation):**
- Add RSI > 55 (for CE) or RSI < 45 (for PE) to prevent entry on exhaustion breakouts
- Add volume > 1.2× avg to confirm genuine expansion

**Risk Calibration:**
| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Capital | ₹12,000 | |
| Max trade loss | ₹200 | 8 pts SL |
| Max daily loss | ₹600 | |
| Profit target | ₹400 | 16 pts target |
| SL (premium pts) | 8 pts | |
| Target (premium pts) | 20 pts | 1:2.5 RR (BB breakouts can run far) |
| Trailing activation | ₹150 | |
| Trailing gap | ₹50 | |

**Session:** 09:25 → lastEntry: 14:45

**Existing Template:** `tpl_bollinger_breakout` — already exists, add RSI + Volume filter in Phase 2

---

### S6 — RSI Exhaustion Reversal
**Category:** MEAN_REVERSION  
**Direction:** BOTH  
**Underlying:** NIFTY  
**Timeframe:** 5m

**Why this strategy?**
The research report identifies oversold (RSI < 30) and overbought (RSI > 70) extremes as high-probability reversal zones. For option buyers, catching a reversal means cheap OTM or ATM premiums at the turning point, which then expand rapidly as the reversal accelerates.

**Entry Logic:**
- **CE (Call Buy):** RSI **CROSSES_ABOVE** 30 **AND** Close > EMA(50)  *(oversold bounce in uptrend)*
- **PE (Put Buy):** RSI **CROSSES_BELOW** 70 **AND** Close < EMA(50)  *(overbought collapse in downtrend)*

**Risk Calibration:**
| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Capital | ₹10,000 | Smaller — reversals can fail |
| Max trade loss | ₹200 | 7 pts SL |
| Max daily loss | ₹600 | |
| Profit target | ₹300 | 15 pts target |
| SL (premium pts) | 7 pts | Tighter — reversal should work quickly |
| Target (premium pts) | 15 pts | 1:2.1 RR |
| Trailing activation | ₹150 | |
| Trailing gap | ₹50 | |

**Session:** 09:25 → lastEntry: 14:45  
`confirmingCandles: 1` — RSI cross must hold one bar  

**Existing Template:** `tpl_rsi_reversal` — already exists, tune capital/limits

---

### S7 — Bear Panic Detector (Bearish Fast-Move PE Buy)
**Category:** TREND (Directional Bearish)  
**Direction:** BEARISH only  
**Underlying:** NIFTY + BANKNIFTY  
**Timeframe:** 5m

**Why this strategy?**
The research report's "Fast-Bear Signals" section identifies 10 indicators for a sharp market drop. This strategy synthesizes those into a **PE buying** trigger optimized for fast-moving sell-offs where Put premiums explode. Based on research findings: price break + volume + RSI crash = panic selling event = ideal Put buy scenario.

**Entry Logic (PE Buy only):**
- EMA 20 < EMA 50 (downtrend confirmed)
- **AND** Close < VWAP (bears in control)
- **AND** RSI(14) < 40 **AND DECREASING** (momentum accelerating down)
- **AND** ATR(14) **INCREASING** (volatility expanding — premiums will inflate)
- **AND** Volume > 1.5× 20-bar average (panic selling volume)

**This is the most stringent entry gate** — all 5 conditions must align. This means fewer trades but very high conviction on the ones that fire.

**Risk Calibration (aggressive target — big moves expected):**
| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| Capital | ₹25,000 | Panic moves can give 3–5× return |
| Max trade loss | ₹400 | 10 pts SL |
| Max daily loss | ₹1,000 | Only 2–3 of these signals per month |
| Profit target | ₹1,200 | 30 pts target × qty (1:3 RR) |
| SL (premium pts) | 10 pts | |
| Target (premium pts) | 30 pts | 1:3 RR — panic moves go far |
| Trailing activation | ₹300 | Let winner run longer |
| Trailing gap | ₹100 | |

**Session:** 10:00 → lastEntry: 14:00 (opening hour too noisy for panic detection)  
`confirmingCandles: 2` — require 2 consecutive bearish candles  
`cooldownBars: 5` — one signal per major move only  

**Contract Selection:** Consider 1-OTM Put (strikeDistance: 1, strikeSelection: OTM) for cheaper premium + higher leverage on big moves

**Implementation Note:** This strategy does NOT exist yet as a template. It needs to be created as a new template `tpl_bear_panic_detector` in `strategy-templates.ts`.

---

## Implementation Roadmap

### Phase 1: Activate Existing Templates (Completed)
Configured and calibrated risk profiles for foundational directional setups:
- **S1 — Triple Confirmation Trend** (`tpl_trend_following`): Calibrated with 8 pts SL, 20 pts Target, 60 pt trailing gap, and ₹500 net profit target.
- **S2 — VWAP Institutional Surge** (`tpl_vwap_momentum`): Session window constrained to `14:30` cut-off and calibrated profit targets.
- **S3 — Opening Range Breakout** (`tpl_opening_range_breakout`): Added dual EMA trend filter (EMA 20 > EMA 50 for Bullish CE, EMA 20 < EMA 50 for Bearish PE) to filter false morning breakouts.

### Phase 2: Clone and Customize Existing Templates (Completed)
- **S4 — EMA Crossover BANKNIFTY** (`tpl_ema_crossover`): Configured for BANKNIFTY high-beta swings, added 20-bar volume confirmation gate, 12 pts SL, 25 pts Target, and 80 pt trailing lock.
- **S5 — Bollinger Squeeze Breakout** (`tpl_bollinger_breakout`): Added RSI momentum confirmation (RSI > 55 for Bullish, RSI < 45 for Bearish) and 1.2× volume expansion filter.
- **S6 — RSI Exhaustion Reversal** (`tpl_rsi_reversal`): Verified tight mean-reversion risk profile (7 pts SL, 15 pts Target, ₹300 net profit target).

### Phase 3: New Template Development (Completed)
- **S7 — Bear Panic Detector** (`tpl_bear_panic_detector`): Created new directional bearish template with 5-gate AND confluence (EMA 20 < 50, Price < VWAP, RSI < 40 decreasing, ATR expanding, and Volume > 1.5× avg) with 10 pts SL and 30 pts Target (1:3 R/R) on 1-OTM Puts.

### Phase 4: Multi-Strategy Backtesting & Paper Trading Validation Suite (Completed)
- Automated verification in [`packages/domain/src/__tests__/strategy-roadmap-validation.spec.ts`](file:///Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/__tests__/strategy-roadmap-validation.spec.ts).
- All 7 templates verified against deterministic 14-day multi-session historical candle feeds (`NIFTY` and `BANKNIFTY`).
- Zero NaN exceptions; statutory option charges (STT, exchange fees, SEBI, GST, stamp duty) and fixed-step trailing stops validated.
- `StrategyConfigSchema` and immutable version hashing verified across all 7 instantiated strategy configurations.
- Full workspace test suite: **38 test files, 371 tests passed (100% pass rate)**.

---

## Risk Management Architecture (All Strategies)

### Daily Kill Switch
The platform's daily loss monitor auto-stops new entries when `maxAllInDailyLossInr` is hit. This is hard-coded and cannot be overridden by any strategy.

### Capital Allocation Across Simultaneous Strategies
**Do NOT run multiple strategies simultaneously in Live mode** until you have 30+ days of paper trading data per strategy. In Live mode:
- Run **S1 only** as the primary strategy initially
- Graduate to 2 strategies maximum (e.g., S1 + S3) once S1 is consistently profitable

### Risk Budget Summary

| Mode | Daily Loss Cap | Active Strategies | Max Simultaneous Capital |
| :--- | :--- | :--- | :--- |
| Paper | No real money | All 7 | N/A |
| Live Pilot | ₹600/day | 1 strategy | ₹15,000 |
| Live Scaled | ₹1,000/day | 2 strategies max | ₹25,000 |

### Go-Live Checklist Per Strategy
Before switching any strategy from Paper → Live:
- [ ] Minimum **10 paper trades** completed
- [ ] Paper win rate ≥ 40%
- [ ] Paper R/R ratio ≥ 1:1.5 on average
- [ ] No single loss exceeds `maxAllInTradeLossInr`
- [ ] At least 3 consecutive profitable paper days
- [ ] Owner Go-Live checklist signed in Workstation
- [ ] Upstox OAuth token valid and verified

---

## What We Are NOT Building (Yet)

From the research report, the following strategies are **deferred** due to platform constraints:

| Strategy | Reason for Deferral |
| :--- | :--- |
| Short ATM Straddle | Requires SELL side — not in `AllowedOptionType` |
| Short OTM Strangle | Requires SELL side — not supported |
| Iron Condor | Multi-leg with sell — not supported |
| Bull Put Spread / Bear Call Spread | Credit spread — requires SELL leg |
| Wheel Strategy | Assignment-based — not applicable to index options |
| Long Straddle (Buy CE + PE together) | Requires 2 simultaneous positions — `maxOpenPositions: 1` blocks this |

> **Future Enhancement:** If the platform adds `SHORT_CALL` / `SHORT_PUT` to `AllowedOptionType` and implements margin management, credit spreads (Iron Condor, Bull Put Spread) would be the highest priority additions given their 65–75% win rate from the research.

---

## Files to Create / Modify

| File | Action | Strategy |
| :--- | :--- | :--- |
| [`packages/domain/src/strategy-templates.ts`](file:///Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/strategy-templates.ts) | ADD new template `tpl_bear_panic_detector` | S7 |
| [`packages/domain/src/strategy-templates.ts`](file:///Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/strategy-templates.ts) | MODIFY `tpl_opening_range_breakout` — add EMA trend filter | S3 |
| [`packages/domain/src/strategy-templates.ts`](file:///Users/user/Documents/Projects/TRADING-BOT/packages/domain/src/strategy-templates.ts) | MODIFY `tpl_bollinger_breakout` — add RSI + Volume filter | S5 |
| `docs/STRATEGY_ROADMAP.md` | This file — strategy specifications | All |

---

*Last updated: October 2026*  
*Research source: `docs/deep-research-report.md`*
