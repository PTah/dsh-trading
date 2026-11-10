# Agent Note: 俄股市场 `ru` + T-Bank Invest 连接器

Status: implemented

## Problem

公开仓需要对接 T-Bank Invest（原 Tinkoff Invest API）以支持俄罗斯 MOEX 行情与受闸门约束的下单。既有市场键（crypto/us/cn/hk/futures/global）均不承载 MOEX 符号与 T-Bank 账户语义。

## Decision

新增市场短前缀 **`ru`**，并落地：

- `@dshtrading/connector-tbank`：REST/Swagger 代理（`invest-public-api.tinkoff.ru/rest` / sandbox host），Bearer token（`TBANK_TOKEN` / `TBANK_DEMO_TOKEN`），工具前缀 `ru_*`，quantity 为股数、按 lot 向下取整为手数。
- `@dshtrading/kit-ru` + `@dshtrading/ru`：risk checklist + preset `ru-trader` + host dataplane 注册 `(ru, tbank)`。
- base 闸门扩为含 `ru_(place|cancel)_order`；router `DEFAULT_MARKETS.ru = tbank`；设置页 `MARKET_TABS` 含 `ru`（词典 `market.ru`）+ `PROVIDER_LABELS` / 凭据卡 `token`；desktop profile 依赖与 bundle 列表纳入 `@dshtrading/ru`。
- `@dshtrading/bot-api` 桥面 `MarketId` / `MARKET_IDS` / `MARKET_SERVICE_KEYS` 含 `ru → tradingRuMarketData`；漏写时 GUI `/klines` 等直接 400 `unknown market "ru"`（与连接器是否已装无关）。
- 设置页市场 tab 不是从已装 bundle 动态推断：漏写 `MARKET_TABS` 时 Settings→Trading 只显示旧六市，即使用户 profile 已装 `@dshtrading/ru`。

协议取舍：官方主协议是 gRPC，本仓连接器一律走已公开的 REST 代理（与 Alpaca/Longbridge 同构的 `fetch` 管线，零原生 gRPC 依赖）。沙箱用独立 host，不走 `SandboxService` 专用方法名（与官方「优先 sandbox host」建议一致）。

## Consequences

- 出网实证已落 `spikes/impl-tbank/`（2026-11-09）：sandbox `GetAccounts` / `FindInstrument(SBER)` / `GetLastPrices`；本机 TLS 被中间人证书拦截时需系统信任根或临时 `NODE_TLS_REJECT_UNAUTHORIZED=0`。凭证只进 User env（`TBANK_DEMO_TOKEN` / `TBANK_TOKEN`），不进仓库。
- 本机复现（2026-11-09）：未设 `NODE_TLS_REJECT_UNAUTHORIZED=0` 时 Node `fetch` 对 sandbox/live 一律 `SELF_SIGNED_CERT_IN_CHAIN` → 桥面 `TRADING_NETWORK: fetch failed`；User env 设为 `0` 后 GetAccounts/GetCandles(SBER TQBR)/GetLastPrices 正常。Windows 下改 User env 后要对已开的 Explorer 广播 `WM_SETTINGCHANGE` 或从带该变量的进程冷启动桌面壳，否则 GUI 仍用旧环境。
- GetCandles 单次窗受官方 30014 约束（日 K ≤1 年、4h ≤1 月等，见 FAQ）；GUI `/klines?interval=1d&limit=750` 会超窗。`getKlines` 按 `INTERVAL_MAX_WINDOW_MS` 向后翻页聚合，并把 K 线字段对齐 `openTime`/`closeTime`（勿用 `timestamp`）。`klineCapabilities` 必须返回 `KlineCapability[]`，对象形会被桥当成「未声明」。
- 选股器扫的是 `RU_LIQUID_SHARES`（`listInstruments`），不是 T-Bank Shares 全量。策略页在原有六条日 K 规则上增加 `trend-sma`、`rsi-14-band`、`peak-drawdown`。「ИИ-аналитика」把这些规则收成一个动作：купить / держать / сократить / подождать。不调用语言模型，也不构成投资建议。
- 债券/期货/期权、stop-orders、stream 行情未接线；本切片覆盖股票/ETF 类 FindInstrument 命中品种的行情与普通限价/市价单。
- profile overrides：凡已装本仓的 trading-web 等 profile 需同步 `@dshtrading/{connector-tbank,kit-ru,ru}`（replication 坑 #15）；桌面壳需重跑 `build-runtime` 才把 ru 打进安装包。

## Verification

- `pnpm --filter @dshtrading/connector-tbank test`（quotation / 符号 / 闸门 / dataplane Config）
- `pnpm --filter @dshtrading/connector-tbank build` 与 `@dshtrading/ru` / `kit-ru` build
- sandbox spike：`spikes/impl-tbank/sandbox-*.json`（GetAccounts / FindInstrument SBER / GetLastPrices）
