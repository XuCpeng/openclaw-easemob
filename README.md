# OpenClaw Easemob Plugin

[![npm version](https://badge.fury.io/js/@saber3555%2Fopenclaw-easemob.svg)](https://www.npmjs.com/package/@saber3555/openclaw-easemob)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[OpenClaw](https://openclaw.ai) 的 **环信IM (Easemob)** 通道插件，让你的 AI 代理可以通过环信平台与用户聊天。

---

## 三步快速开始

```bash
# 1. 安装插件
openclaw plugins install @saber3555/openclaw-easemob

# 2. 配置插件（按提示输入环信凭据）
openclaw config

# 3. 在环信控制台配置 Webhook
# URL: https://your-gateway-host/webhooks/easemob
```

完成！用户现在可以通过环信向你的机器人发送消息了。

---

## 功能特性

- ✅ **单聊支持** - 与用户进行一对一对话
- ✅ **Webhook 集成** - 实时接收消息
- ✅ **Token 自动管理** - 自动获取和缓存访问令牌
- ✅ **配置向导** - 交互式 CLI 配置
- ✅ **连接测试** - 自动验证配置正确性

## 安装

```bash
openclaw plugins install @saber3555/openclaw-easemob
```

## 快速开始

### 1. 获取环信凭据

1. 登录 [环信控制台](https://console.easemob.com)
2. 创建新应用或选择现有应用
3. 在「应用概览」中获取:
   - **OrgName** - 组织名称
   - **AppName** - 应用名称
   - **Client ID** - 客户端 ID
   - **Client Secret** - 客户端密钥
4. 在「用户认证」中创建一个用户作为机器人账号

### 2. 配置插件

```bash
openclaw config
```

按提示输入:
- OrgName
- AppName
- Client ID
- Client Secret
- 机器人用户名

### 3. 配置 Webhook 回调

1. 确保 OpenClaw Gateway 可以从公网访问
2. 登录环信控制台
3. 进入「应用设置」→「消息回调」
4. 添加回调 URL:
   ```
   https://your-gateway-host/webhooks/easemob
   ```
5. 选择回调类型: **单聊消息**
6. 保存配置

### 4. 开始聊天

现在用户可以通过环信向你的机器人发送消息了！

## 配置说明

配置文件位置: `~/.openclaw/config.json`

```json
{
  "channels": {
    "easemob": {
      "accounts": {
        "robot_username": {
          "accountId": "robot_username",
          "orgName": "your-org",
          "appName": "your-app",
          "clientId": "your-client-id",
          "clientSecret": "your-client-secret",
          "enabled": true,
          "dmPolicy": "pairing",
          "allowFrom": ["user1", "user2"]
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `accountId` | string | ✅ | 环信用户 ID (用户名) |
| `orgName` | string | ✅ | 环信组织名称 |
| `appName` | string | ✅ | 环信应用名称 |
| `clientId` | string | ✅ | 环信 Client ID |
| `clientSecret` | string | ✅ | 环信 Client Secret |
| `enabled` | boolean | ❌ | 是否启用此账号 |
| `name` | string | ❌ | 显示名称 |
| `dmPolicy` | string | ❌ | DM 策略: `open`/`pairing`/`allowlist` |
| `allowFrom` | array | ❌ | 允许列表 |

### DM 策略说明

- **`pairing`** (默认) - 需要用户先与代理配对
- **`allowlist`** - 只允许列表中的用户发送消息
- **`open`** - 允许任何用户发送消息（不推荐）

## 常用命令

```bash
# 查看通道状态
openclaw channels status

# 测试发送消息
openclaw message send --channel easemob --to <user_id> "Hello!"

# 查看配置
openclaw config get channels.easemob

# 重新配置
openclaw config

# 禁用通道
openclaw config set channels.easemob.enabled false

# 查看网关日志
openclaw gateway logs

# 调试模式运行网关
DEBUG=easemob openclaw gateway run
```

## 开发

### 本地安装测试

```bash
# 克隆仓库
git clone https://github.com/XuCpeng/openclaw-easemob.git
cd openclaw-easemob

# 安装依赖
pnpm install

# 构建
pnpm run build

# 本地安装到 OpenClaw
openclaw plugins install ./

# 开发模式（自动重编译）
pnpm run dev
```

## 常见问题

### Q: 为什么收不到消息？

A: 请检查:
1. Gateway 是否运行: `openclaw gateway status`
2. Webhook URL 是否正确配置
3. 防火墙是否允许外部访问 Gateway 端口
4. 环信控制台中的回调是否启用

### Q: Token 过期怎么办？

A: 插件会自动管理 Token，在过期前自动刷新，无需手动处理。

### Q: 支持群聊吗？

A: 当前版本 (P0) 仅支持单聊。群聊支持将在后续版本添加。

### Q: 如何配置多账号？

A: 在 `accounts` 对象中添加多个账号配置:

```json
{
  "accounts": {
    "robot1": { ... },
    "robot2": { ... }
  }
}
```

## 技术架构

本插件采用 **Webhook 网关模式**：

```
用户手机 ──→ 环信服务器 ──→ OpenClaw Gateway ──→ OpenClaw Agent
                              (Webhook)
```

- 不保持长连接，通过环信 Webhook 接收消息
- 通过 REST API 发送消息
- 支持 OAuth2 Token 自动管理

详细设计说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)

## 相关链接

- [OpenClaw 官方文档](https://docs.openclaw.ai/channels)
- [环信官方文档](https://docs.easemob.com/)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [参考项目](https://github.com/dujiepeng/openclaw)

## 贡献

欢迎提交 Issue 和 PR！

## 许可证

MIT License - 详见 [LICENSE](./LICENSE)

---

Made with ❤️ by [XuCpeng](https://github.com/XuCpeng)
