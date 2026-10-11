# Backtest audit evidence

These fixtures accompany [the 11 October 2026 audit](../BACKTEST_ENGINE_AUDIT.md). They reproduce defects at commit `b061edf`; they do not demonstrate strategy profitability. Candles, provider responses and proposal quotes are deliberately artificial. The scripts stub or deny networking and do not use owner credentials or send orders.

Run from the repository root:

```sh
pnpm exec vitest run --config docs/audit/vitest.config.ts --maxWorkers=1 --minWorkers=1
pnpm exec tsx docs/audit/execution-backtest-audit.mts
node --import tsx docs/audit/historical-data-probe.mts
TSX_TSCONFIG_PATH=apps/api/tsconfig.json node --import tsx docs/audit/historical-api-probe.mts
node --import tsx docs/audit/strategy-backtest-audit.mts
```

| Artifact | Evidence |
| --- | --- |
| `backtest-audit.probe.ts` | Six source-level observations: future MTF changes prior entries, unfunded PAM trades and fee-cap breach, ignored settings, incomplete five-minute buckets, API risk overrides and mismatched intervals. |
| `execution-backtest-audit.mts` | Primary-engine fills, cumulative loss policy, open-position drawdown, after-hours settlement, tick accounting, trailing, sizing and financial gate parity. |
| `historical-data-probe.mts` | Stubbed provider identity, interval, dates, incomplete coverage/bars, historical calendars and warmup. |
| `historical-api-probe.mts` | Actual service flow and controller metadata registered into an in-process Express router. This does not verify a deployed server. |
| `strategy-backtest-audit.mts` | Source AST/cache causality, unavailable data, source/multiplier handling, template feasibility, legacy conversion and runtime parity. |

The six Vitest assertions intentionally match current incorrect behavior. They are audit observations rather than acceptance tests, isolated from the ordinary suite by a dedicated configuration. When fixing the engine, convert these fixtures to assertions of the required correct behavior and move them into the relevant regression suite.

The API script requires installed workspace dependencies and uses the API TypeScript configuration for decorators. Source tests use the repository's Vitest aliases; standalone API imports use the workspace's normal package resolution, so build the domain/contracts packages if their compiled exports are unavailable. Dates after the audit date are only deterministic fixtures, not claimed historical data.
