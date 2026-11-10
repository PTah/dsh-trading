# Agent Note: 左栏自选只露俄股 `ru`

Status: implemented

## Problem

桌面安装后「Избранное」页签聚合全部市场种子，crypto/us 默认行（BTC/ETH、AAPL…）与市场胶囊一起占满左栏；俄股 T-Bank 用户只想看见 `ru`。

## Decision

`client-ui-trading` 增加 `SIDEBAR_MARKETS = ['ru']` 与 `filterSidebarMarkets`：`/markets` 回包在侧栏页签、自选聚合、添加目标循环处按该表收窄。其它市场 bundle 仍可安装（Settings / 工具面不变），只是不进左栏。

## Consequences

- 要重新露出多市场：改 `SIDEBAR_MARKETS` 并重建 `@dshtrading/client-ui-trading`。
- 既有 localStorage / host 里的 crypto·us 定制行不会自动删除；侧栏不再聚合它们后用户看不见即可。
- 图表指标名（成交量 / 量比分档量能 / 超级趋势 / 输出 key）仍是定义侧中文契约键；俄文终端只在 `client-ui-trading` 的 `ruIndicatorLabel` 渲染层替换，不改 compute key。
