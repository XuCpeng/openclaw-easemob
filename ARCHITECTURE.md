# Easemob Channel 技术设计说明

## 1. 架构概述

本插件实现 OpenClaw 与环信 IM (Easemob) 的集成，采用 **Webhook 网关模式** 实现服务端消息收发。

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   用户手机   │────→│  环信服务器  │────→│ OpenClaw Gateway │────→│  OpenClaw   │
│  (环信 App)  │     │             │     │   (Webhook)      │     │    Agent    │
└─────────────┘     └─────────────┘     └──────────────────┘     └─────────────┘
                                              │
                                              ↓ POST /webhooks/easemob
                                       ┌─────────────┐
                                       │  本插件入口  │
                                       │ src/index.ts │
                                       └─────────────┘
```

## 2. 为什么使用 Webhook 而非 SDK

| 维度 | IM 客户端 SDK | OpenClaw Channel |
|------|--------------|------------------|
| **运行位置** | 用户设备 | 服务器/网关 |
| **连接方式** | 长连接 (TCP/WebSocket) | 无长连接，HTTP 请求 |
| **接收消息** | SDK 内部推送 | Webhook 回调 |
| **架构角色** | 客户端消费者 | 服务端服务 |

**核心原因**：OpenClaw 是服务端 AI Agent，不是客户端应用：
- 不需要保持与环信的长连接
- 通过环信「消息回调」功能被动接收消息
- 通过 REST API 主动发送消息

## 3. 核心组件

### 3.1 消息接收流程

```
环信 Webhook ──→ src/index.ts (registerHttpRoute)
                     ↓
              handleEasemobWebhook()
                     ↓
              验证 eventType & chat_type
                     ↓
              匹配 recipient (to) 到 account
                     ↓
              dispatchReplyFromConfig() ──→ 生成回复
```

### 3.2 消息发送流程

```
Agent 回复 ──→ sendText() (src/channel.ts:241)
                   ↓
              获取 Access Token (probe.ts)
                   ↓
              POST /messages (环信 REST API)
                   ↓
              返回发送结果
```

## 4. 关键实现细节

### 4.1 认证机制

使用 OAuth2 `client_credentials` 模式获取 Token：

```typescript
// src/probe.ts
const tokenResponse = await fetch(`https://a1.easemob.com/${orgName}/${appName}/token`, {
  method: "POST",
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }),
});
```

Token 自动缓存，避免频繁请求。

### 4.2 账号配置

采用 OpenClaw 标准的多账号架构：

```json
{
  "channels": {
    "easemob": {
      "accounts": {
        "default": {
          "accountId": "robot_username",
          "orgName": "your-org",
          "appName": "your-app",
          "clientId": "xxx",
          "clientSecret": "xxx"
        }
      }
    }
  }
}
```

- `DEFAULT_ACCOUNT_ID = "default"` 作为默认账号键
- onboarding 时使用 default 键存储配置，保持与其他 Channel 一致

### 4.3 Webhook 处理

```typescript
// src/channel.ts:337
export async function handleEasemobWebhook(payload, cfg, api) {
  // 1. 验证消息类型
  if (chatType !== "chat" && chatType !== "direct") return notHandled;
  if (eventType !== "chat" && eventType !== "receive_message") return notHandled;

  // 2. 匹配目标账号
  const matchedAccount = findAccountByRecipient(to);

  // 3. 构造上下文并分派回复
  const ctx = buildInboundContext(payload);
  await dispatchReplyFromConfig({ cfg, ctx, dispatcher });
}
```

### 4.4 DM 策略支持

支持三种私信策略：
- `open` - 允许任何人
- `pairing` - 需要配对（默认）
- `allowlist` - 仅允许列表用户

```typescript
// src/onboarding.ts:277
dmPolicy: {
  getCurrent: (cfg) => cfg.channels.easemob.accounts[accountId]?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setEasemobDmPolicy(cfg, policy),
}
```

## 5. 目录结构

```
/home/saber/space/openclaw-easemob-plugin/
├── src/
│   ├── index.ts       # 插件入口，注册 Webhook 路由
│   ├── channel.ts     # ChannelPlugin 完整实现
│   ├── onboarding.ts  # CLI 配置向导
│   ├── probe.ts       # 连接探测 & Token 管理
│   └── types.ts       # TypeScript 类型定义
├── openclaw.plugin.json  # 插件清单
├── package.json       # npm 包配置
└── README.md          # 使用文档
```

## 6. 数据流向总结

```
[用户发送消息]
      ↓
[环信服务器]
      ↓ (Webhook 回调)
[POST /webhooks/easemob]
      ↓
[handleEasemobWebhook]
      ↓
[dispatchReplyFromConfig]
      ↓
[sendText → 环信 REST API]
      ↓
[用户收到回复]
```

## 7. 关键代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| Webhook 注册 | `src/index.ts` | 15-25 |
| Webhook 处理 | `src/channel.ts` | 337-409 |
| 消息发送 | `src/channel.ts` | 241-293 |
| Token 获取 | `src/probe.ts` | 15-45 |
| 配置向导 | `src/onboarding.ts` | 183-275 |
| DM 策略 | `src/onboarding.ts` | 277-296 |

## 8. 扩展建议

P1 阶段可考虑：
1. **群聊支持** - 处理 `chat_type: "group"`
2. **媒体消息** - 实现 `sendMedia` 适配器
3. **消息回执** - 处理消息已读/送达状态
4. **多设备同步** - 支持同一账号多设备登录
