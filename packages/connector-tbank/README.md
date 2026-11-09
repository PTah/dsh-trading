# @dshtrading/connector-tbank

俄罗斯 MOEX 市场连接器：对接 [T-Bank Invest API](https://developer.tbank.ru/invest/api)（原 Tinkoff Invest）的 REST/Swagger 代理。

## 能力面

| 面 | 方法 | 说明 |
|---|---|---|
| 行情 | `GetLastPrices` / `GetCandles` / `GetOrderBook` / `FindInstrument` | 需 token；符号 `SBER` 或 `SBER.TQBR` |
| 账户 | `GetAccounts` / `GetPositions` | 缺省取第一个 OPEN 账户；可用 `accountId` 固定 |
| 交易 | `PostOrder` / `CancelOrder` / `GetOrderState` / `GetOrders` | quantity 入参为**股数**，按 lot 向下取整为手数 |

## 环境

| Config.env | Host |
|---|---|
| `demo`（缺省） | `https://sandbox-invest-public-api.tinkoff.ru/rest` |
| `live` | `https://invest-public-api.tinkoff.ru/rest` |

凭证（BYOK）：

- 实盘：`TBANK_TOKEN`
- 沙箱：`TBANK_DEMO_TOKEN`（可与实盘同 token；host 仍按 env 分流）

设置页卡片键：`dshtrading.credentials.tbank.token`。

## 安全

- `dryRun` 缺省 `true`；`liveTrading` 缺省 `false`
- 实盘须 `@dshtrading/authority` 人工签署授权 + 逐单审批
- 幂等：`PostOrder.orderId` ≤ 36 字符，本地 `OrderIntentLedger` 先落盘后触网

## 工具名

`ru_get_ticker` / `ru_get_klines` / `ru_get_orderbook` / `ru_get_balance` / `ru_get_positions` / `ru_place_order` / `ru_cancel_order`

## 出网验证

有沙箱 token 时：

```sh
# 例：查 SBER 最新价（自行组 curl，勿把 token 写入仓库）
curl -s -X POST https://sandbox-invest-public-api.tinkoff.ru/rest/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts \
  -H "Authorization: Bearer $TBANK_DEMO_TOKEN" -H "Content-Type: application/json" -d '{}'
```

原始响应证据落 `spikes/impl-tbank/`（连接器出网验证铁律）。
