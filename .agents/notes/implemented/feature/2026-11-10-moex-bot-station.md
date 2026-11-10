# Agent Note: MOEX 日线机器人用现有策略引擎做模拟单

Status: implemented

## Problem

策略页签能回测，没有进程在收盘后按同一套规则提出买入、加仓或卖出。用户看到的是有页签、没有机器人。

## Decision

`@dshtrading/strategies` 的 `decideBotBook` 是纯函数。新买入只发生在最后一根已收盘日 K：SMA20 刚上穿 SMA50，且收盘仍在 SMA50 之上。一轮最多三只，按短均线相对长均线的距离排序。已买入的名字记在本机 `dshtrading.bot.book.v1`，不读、不改用户自选。账上的名字：均线重新下穿或收盘跌破 SMA50 就卖出全部手数；趋势仍在、收盘回到 SMA20 附近（±1.5%）且还没加过仓，就加 1 手，只加一次。IMOEX、RGBI、RTSI、MOEX 和 SU 债券直接跳过。

策略页签多一块「Робот」。检查读取俄罗斯名册里前 30 个股票代码的日 K，再补上账本里没出现在这 30 个里的名字。提交按钮调用 `placeBotDryRunOrder`，请求体里的 `dryRun` 固定为 true，不走实盘审批，也不打开 liveTrading。模拟单被接受后才改账本。

## Alternatives considered

嵌入 Freqtrade、OsEngine 或 StockSharp。它们是另一套进程和另一条下单路径，会绕开这里已经有的 dry-run 闸门。

第一版做网格。网格要连续改限价单，和「收盘看一次、一手多头、先模拟」不是同一件事。

用自选列表当扫描池。自选是用户自己的观察名单，清掉它才会让机器人有东西可买，这个要求不成立。

## Consequences

机器人不读取真实持仓。账本只记录它自己发出的模拟单。名册前 30 个股票代码之外的新名字，要等它们进入这 30 个或已经在账本里才会被看到。费用仍是回测引擎的占位，不在这张模拟单里重算。
