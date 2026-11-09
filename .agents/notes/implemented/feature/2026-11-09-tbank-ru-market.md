# Agent Note: 俄股市场 `ru` + T-Bank Invest 连接器

Status: implemented

## Problem

公开仓需要对接 T-Bank Invest（原 Tinkoff Invest API）以支持俄罗斯 MOEX 行情与受闸门约束的下单。既有市场键（crypto/us/cn/hk/futures/global）均不承载 MOEX 符号与 T-Bank 账户语义。

## Decision

新增市场短前缀 **`ru`**，并落地：

- `@dshtrading/connector-tbank`：REST/Swagger 代理（`invest-public-api.tinkoff.ru/rest` / sandbox host），Bearer token（`TBANK_TOKEN` / `TBANK_DEMO_TOKEN`），工具前缀 `ru_*`，quantity 为股数、按 lot 向下取整为手数。
- `@dshtrading/kit-ru` + `@dshtrading/ru`：risk checklist + preset `ru-trader` + host dataplane 注册 `(ru, tbank)`。
- base 闸门扩为含 `ru_(place|cancel)_order`；router `DEFAULT_MARKETS.ru = tbank`；设置页 `PROVIDER_LABELS` / 凭据卡 `token`；desktop profile 依赖与 bundle 列表纳入 `@dshtrading/ru`。

协议取舍：官方主协议是 gRPC，本仓连接器一律走已公开的 REST 代理（与 Alpaca/Longbridge 同构的 `fetch` 管线，零原生 gRPC 依赖）。沙箱用独立 host，不走 `SandboxService` 专用方法名（与官方「优先 sandbox host」建议一致）。

## Consequences

- 出网实证（真实 token + 原始响应）尚未入库：需用户提供沙箱 token 后落 `spikes/impl-tbank/`。
- 债券/期货/期权、stop-orders、stream 行情未接线；本切片覆盖股票/ETF 类 FindInstrument 命中品种的行情与普通限价/市价单。
- profile overrides：凡已装本仓的 trading-web 等 profile 需同步 `@dshtrading/{connector-tbank,kit-ru,ru}`（replication 坑 #15）；桌面壳需重跑 `build-runtime` 才把 ru 打进安装包。

## Verification

- `pnpm --filter @dshtrading/connector-tbank test`（quotation / 符号 / 闸门 / dataplane Config）
- `pnpm --filter @dshtrading/connector-tbank build` 与 `@dshtrading/ru` / `kit-ru` build
- 有 token 时：sandbox `UsersService/GetAccounts` + `MarketDataService/GetLastPrices` 原始响应入 spikes
