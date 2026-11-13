# Agent Note: 左栏自选只露俄股 `ru`

Status: implemented

## Problem

桌面安装后「Избранное」页签聚合全部市场种子，crypto/us 默认行（BTC/ETH、AAPL…）与市场胶囊一起占满左栏；俄股 T-Bank 用户只想看见 `ru`。

## Decision

`client-ui-trading` 增加 `SIDEBAR_MARKETS = ['ru']` 与 `filterSidebarMarkets`：`/markets` 回包在侧栏页签、自选聚合、添加目标循环处按该表收窄。其它市场 bundle 仍可安装（Settings / 工具面不变），只是不进左栏。

「Россия」的角色分组和全名册在同一个 `.list` 里滚动。角色行用名册行的两列网格，名次说明过长时在行内省略，不把行撑出侧栏。IMOEX 股票和 RGBI 国债各自有领先、上升、长期落后。角色来自近八个交易周的价格动量名次，不是买卖建议。全名册仍按股票 / 基金 / 债券折叠。「Избранное」只渲染自选行。自选行按名册标成股票（蓝）/ 基金（紫）/ 债券（琥珀），左侧色条加短标签；未知类型不猜测。排序是表头上方标着「Сортировка」的下拉：加入顺序、名称、代码、类型、价格高低、涨跌幅高低。两个区各有自己的下拉。「Россия」渲染 T-Bank `Shares` / `Etfs` / `Bonds` 里可交易的 MOEX 板块（TQBR、TQTF/TQTD、TQOB/TQCB/TQIR/TQOD），按股票 / 基金 / 债券分组，分组默认折叠，标题上的三角展开一块。点行只选中标的；「В избранное」才写入自选。名册不参与侧栏行情轮询。连接器没有 token 或请求失败时，名册退回 `RU_LIQUID_SHARES`。

## Consequences

- 要重新露出多市场：改 `SIDEBAR_MARKETS` 并重建 `@dshtrading/client-ui-trading`。
- 既有 localStorage / host 里的 crypto·us 定制行不会自动删除；侧栏不再聚合它们后用户看不见即可。
- 图表指标名（成交量 / 量比分档量能 / 超级趋势 / 输出 key）仍是定义侧中文契约键；俄文终端只在 `client-ui-trading` 的 `ruIndicatorLabel` 渲染层替换，不改 compute key。
