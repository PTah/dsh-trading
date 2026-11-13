# Agent Note: 选中标的随聊天问题一起发出

Status: implemented

## Problem

左栏点开「Озон」后，右侧行情头已经是这家公司，但宿主聊天框看不到这次点选。问题发出去时模型不知道在问哪一张纸。

## Decision

`client-ui-trading` 在宿主 composer 提交前（捕获阶段的 Enter，以及发送箭头的 click）读取当前选中标的。草稿非空、不是斜杠命令、且还没有同一代码的标记时，在草稿开头插入一行：`[Бумага OZON] Озон (OZON), Россия, рынок ru`。名称和代码相同时只留代码。Shift+Enter、停止按钮、没有选中标的，都不插入。宿主 `@deepseek-ai/dsh-client-ui-conversation` 不改；插入走它已经在听的 `beforeinput` / `insertText`。

## Alternatives considered

改宿主 composer，让它读交易选中态。宿主是只读安装包，升级会被覆盖，而且选中态不在它的契约里。

只在输入框旁边画一枚芯片。人看得到，发出去的文本里仍然没有公司名，模型还是不知道。

把公司名追加到问题末尾。用户要求的是发送前放在前面，模型先读到标的再读问题。

## Consequences

发出的用户消息正文里能看见这一行。同一草稿不会叠两次。换一张纸再问，标记换成新代码。斜杠命令原样交给宿主。
