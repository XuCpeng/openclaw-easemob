/**
 * Easemob Channel Plugin
 *
 * OpenClaw Channel Plugin for Easemob (环信) IM platform.
 * Provides webhook-based message receiving and REST API-based message sending.
 */

import type { EasemobAccountConfig, EasemobConfig, EasemobWebhookPayload, OpenClawConfig } from "./types.js";
import { easemobOnboardingAdapter } from "./onboarding.js";
import { getAccessToken, probeEasemob } from "./probe.js";

/** Default account ID for single-account mode */
const DEFAULT_ACCOUNT_ID = "default";

/**
 * Channel API interface for webhook handling
 */
interface ChannelAPI {
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
  runtime: {
    channel: {
      reply: {
        finalizeInboundContext: (ctx: InboundContext) => FinalizedContext;
        dispatchReplyFromConfig: (params: {
          cfg: OpenClawConfig;
          ctx: FinalizedContext;
          dispatcher: ReplyDispatcher;
        }) => Promise<void>;
      };
    };
  };
}

/**
 * Raw inbound context from webhook
 */
interface InboundContext {
  From: string;
  To: string;
  Body: string;
  ChatType: "direct";
  MessageSid?: string;
  Surface: string;
  Provider: string;
  WasMentioned: boolean;
  raw: EasemobWebhookPayload;
}

/**
 * Finalized context after processing
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FinalizedContext = any;

/**
 * Reply dispatcher interface
 */
interface ReplyDispatcher {
  sendFinalReply: (payload: { text?: string }) => boolean;
  sendBlockReply: () => boolean;
  sendToolResult: () => boolean;
  waitForIdle: () => Promise<void>;
  getQueuedCounts: () => { final: number; block: number; tool: number };
}

/**
 * Result of handling a webhook
 */
interface WebhookResult {
  handled: boolean;
  replies: string[];
}

/** Gets an Easemob account from config by ID or returns the first available */
function getAccount(
  cfg: OpenClawConfig,
  accountId?: string
): EasemobAccountConfig | null {
  const easemobCfg = cfg.channels?.easemob as EasemobConfig | undefined;
  const accounts = easemobCfg?.accounts || {};

  if (accountId) {
    // First try to find by key (e.g., "default")
    if (accounts[accountId]) {
      return accounts[accountId];
    }
    // Then try to find by accountId field value (e.g., "xcp_claw_test")
    const matched = Object.values(accounts).find(
      (acc) => acc?.accountId === accountId
    );
    if (matched) {
      return matched;
    }
    return null;
  }

  // If no accountId specified, return the first available account
  const firstKey = Object.keys(accounts)[0];
  return firstKey ? accounts[firstKey] : null;
}

/** Builds a new config path with updated accounts */
function buildConfigPath(cfg: OpenClawConfig, accounts: Record<string, EasemobAccountConfig>) {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      easemob: {
        ...cfg.channels?.easemob,
        accounts,
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const easemobPlugin: any = {
  id: "easemob",
  meta: {
    id: "easemob",
    label: "Easemob",
    selectionLabel: "Easemob (环信IM)",
    docsPath: "/channels/easemob",
    docsLabel: "easemob",
    blurb: "Easemob (环信) enterprise instant messaging platform.",
    aliases: ["环信"],
    order: 36,
  },

  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    edit: false,
    reply: false,
    polls: false,
    threads: false,
  },

  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        defaultAccount: { type: "string", description: "默认账号 ID" },
        accountId: { type: "string", description: "账号 ID (通常使用 default)" },
        orgName: { type: "string", description: "环信 OrgName" },
        appName: { type: "string", description: "环信 AppName" },
        clientId: { type: "string", description: "环信 Client ID" },
        clientSecret: { type: "string", description: "环信 Client Secret" },
        enabled: { type: "boolean", default: true },
        name: { type: "string", description: "显示名称" },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        showToolCalls: { type: "string", enum: ["off", "on", "full"], default: "off", description: "是否向用户显示工具调用详情: off=不显示, on=显示工具状态, full=显示完整输出" },
      },
      required: ["accountId", "orgName", "appName", "clientId", "clientSecret"],
    },
  },

  config: {
    listAccountIds: (cfg: OpenClawConfig) => {
      const easemobCfg = cfg.channels?.easemob as EasemobConfig | undefined;
      return Object.keys(easemobCfg?.accounts || {});
    },

    resolveAccount: (cfg: OpenClawConfig, accountId?: string) => {
      const account = getAccount(cfg, accountId || undefined);
      // 如果找不到账号，返回一个默认的未配置账号对象
      // 这在 onboarding 阶段是必要的
      if (!account) {
        const id = accountId || DEFAULT_ACCOUNT_ID;
        return {
          accountId: id,
          orgName: "",
          appName: "",
          clientId: "",
          clientSecret: "",
          enabled: false,
          configured: false,
        } as EasemobAccountConfig;
      }
      return account;
    },

    defaultAccountId: (cfg: OpenClawConfig) => {
      const easemobCfg = cfg.channels?.easemob as EasemobConfig | undefined;
      const accounts = easemobCfg?.accounts || {};
      const accountIds = Object.keys(accounts);
      // 返回第一个账号作为默认账号
      return accountIds[0] || DEFAULT_ACCOUNT_ID;
    },

    setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: OpenClawConfig; accountId?: string; enabled: boolean }) => {
      const accounts = { ...(cfg.channels?.easemob as EasemobConfig | undefined)?.accounts };
      const id = accountId || Object.keys(accounts)[0] || DEFAULT_ACCOUNT_ID;

      if (accounts[id]) {
        accounts[id] = { ...accounts[id], enabled };
      }

      return buildConfigPath(cfg, accounts);
    },

    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string }) => {
      const accounts = { ...(cfg.channels?.easemob as EasemobConfig | undefined)?.accounts };
      const id = accountId || Object.keys(accounts)[0] || DEFAULT_ACCOUNT_ID;

      delete accounts[id];

      if (Object.keys(accounts).length === 0) {
        const next = { ...cfg };
        const nextChannels = { ...cfg.channels };
        delete (nextChannels as Record<string, unknown>).easemob;
        next.channels = nextChannels;
        return next;
      }

      return buildConfigPath(cfg, accounts);
    },

    isConfigured: async (account: EasemobAccountConfig) => {
      return Boolean(
        account.clientId &&
        account.clientSecret &&
        account.orgName &&
        account.appName
      );
    },

    isEnabled: (account: EasemobAccountConfig) => {
      return account.enabled !== false;
    },

    describeAccount: (account: EasemobAccountConfig) => ({
      accountId: account.accountId,
      name: account.name || account.accountId,
      enabled: account.enabled !== false,
      configured: Boolean(
        account.clientId &&
        account.clientSecret &&
        account.orgName &&
        account.appName
      ),
    }),

    resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string }) => {
      const account = getAccount(cfg, accountId || undefined);
      if (!account?.allowFrom) return [];
      return account.allowFrom.map((entry) => String(entry).trim().toLowerCase());
    },

    formatAllowFrom: ({ allowFrom }: { allowFrom: (string | number)[] }) => {
      return allowFrom.map((entry) => String(entry).trim().toLowerCase());
    },
  },

  setup: {
    resolveAccountId: ({ accountId }: { accountId: string }) => {
      return accountId?.trim() || DEFAULT_ACCOUNT_ID;
    },

    applyAccountName: ({ cfg, accountId, name }: { cfg: OpenClawConfig; accountId?: string; name: string }) => {
      const accounts = { ...(cfg.channels?.easemob as EasemobConfig | undefined)?.accounts };
      const id = accountId || Object.keys(accounts)[0] || DEFAULT_ACCOUNT_ID;

      if (accounts[id]) {
        accounts[id] = { ...accounts[id], name };
      }

      return buildConfigPath(cfg, accounts);
    },

    applyAccountConfig: ({ cfg, accountId, input }: { cfg: OpenClawConfig; accountId?: string; input: Partial<EasemobAccountConfig> }) => {
      const accounts = { ...(cfg.channels?.easemob as EasemobConfig | undefined)?.accounts };
      const id = accountId || Object.keys(accounts)[0] || DEFAULT_ACCOUNT_ID;

      accounts[id] = {
        ...accounts[id],
        ...input,
        accountId: id,
        enabled: true,
      };

      return buildConfigPath(cfg, accounts);
    },
  },

  pairing: {
    idLabel: "easemobUserId",
    normalizeAllowEntry: (entry: string) => {
      return entry.replace(/^(easemob|user):/i, "").toLowerCase();
    },
  },

  security: {
    collectWarnings: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string }) => {
      const warnings: string[] = [];
      const account = getAccount(cfg, accountId || undefined);

      if (!account) {
        warnings.push("Easemob account not configured");
        return warnings;
      }

      const dmPolicy = account.dmPolicy || "pairing";

      if (dmPolicy === "open") {
        warnings.push("Easemob DM policy is 'open' - any user can send messages to the agent");
      }

      return warnings;
    },
  },

  outbound: {
    deliveryMode: "gateway",

    sendText: async ({ to, text, accountId, cfg }: { to: string; text: string; accountId?: string; cfg: OpenClawConfig }) => {
      const account = getAccount(cfg, accountId || undefined);

      if (!account) {
        console.error(`[easemob] Cannot send: account not found`);
        return { ok: false, error: "Account not found" };
      }

      try {
        const token = await getAccessToken(account);
        const url = `https://a1.easemob.com/${account.orgName}/${account.appName}/messages`;

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            target_type: "users",
            target: [to],
            msg: {
              type: "txt",
              msg: text,
            },
            from: account.accountId,
          }),
        });

        if (!response.ok) {
          const errData = await response.json() as { error_description?: string };
          console.error(`[easemob] Send failed: ${errData.error_description || response.statusText}`);
          return {
            ok: false,
            error: errData.error_description || response.statusText,
          };
        }

        let messageId: string | undefined;
        try {
          const respData = await response.json() as { data?: string };
          messageId = respData.data;
        } catch {
          // ignore
        }

        return { ok: true, channel: "easemob", messageId };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[easemob] Send error: ${error}`);
        return { ok: false, error };
      }
    },

    sendMedia: undefined,
  },

  status: {
    probeAccount: async ({ account }: { account: EasemobAccountConfig }) => {
      return await probeEasemob(account);
    },

    buildAccountSnapshot: ({ account, probe }: { account: EasemobAccountConfig; probe?: { ok: boolean; error?: string } }) => ({
      accountId: account.accountId,
      name: account.name || account.accountId,
      enabled: account.enabled !== false,
      configured: Boolean(
        account.clientId &&
        account.clientSecret &&
        account.orgName &&
        account.appName
      ),
      connected: probe?.ok ?? false,
      error: probe?.error,
    }),
  },

  gateway: {
    startAccount: async (ctx: { accountId: string; log?: { info: (msg: string) => void }; setStatus: (status: Record<string, unknown>) => void }) => {
      ctx.log?.info(`Starting Easemob account: ${ctx.accountId}`);
      ctx.setStatus({ accountId: ctx.accountId, connected: true });

      return async () => {
        ctx.log?.info(`Stopping Easemob account: ${ctx.accountId}`);
      };
    },
  },

  onboarding: easemobOnboardingAdapter,

  reload: {
    configPrefixes: ["channels.easemob"],
  },
};

/**
 * Handles incoming Easemob webhook payloads.
 *
 * @param payload - The webhook payload from Easemob
 * @param cfg - OpenClaw configuration
 * @param api - Channel API for logging and dispatching
 * @returns Webhook result indicating if message was handled and any replies
 */
export async function handleEasemobWebhook(
  payload: EasemobWebhookPayload,
  cfg: OpenClawConfig,
  api: ChannelAPI
): Promise<WebhookResult> {
  const eventType = payload.eventType || payload.call_back_type;
  const chatType = payload.chat_type;
  const from = payload.from;
  const to = payload.to;

  // Only handle direct chat messages
  if (chatType !== "chat" && chatType !== "direct") {
    return { handled: false, replies: [] };
  }

  if (eventType !== "chat" && eventType !== "receive_message") {
    return { handled: false, replies: [] };
  }

  const easemobCfg = cfg.channels?.easemob as EasemobConfig | undefined;
  const accounts = easemobCfg?.accounts || {};
  const matchedAccount = Object.values(accounts).find(
    (acc) => acc.accountId === to
  );

  if (!matchedAccount) {
    api.logger.info(`Easemob ignored: recipient "${to}" not configured`);
    return { handled: false, replies: [] };
  }

  const text = payload.payload?.bodies?.[0]?.msg;

  if (!text || !from) {
    return { handled: false, replies: [] };
  }

  api.logger.info(`Easemob received message from ${from}: ${text}`);

  const rawCtx: InboundContext = {
    From: from,
    To: to,
    Body: text,
    ChatType: "direct",
    MessageSid: payload.msg_id,
    Surface: "easemob",
    Provider: "easemob",
    WasMentioned: true,
    raw: payload,
  };

  const finalizedCtx = api.runtime.channel.reply.finalizeInboundContext(rawCtx);

  const replies: string[] = [];

  await api.runtime.channel.reply.dispatchReplyFromConfig({
    cfg,
    ctx: finalizedCtx,
    dispatcher: {
      sendFinalReply: (replyPayload: { text?: string }) => {
        if (replyPayload.text) {
          replies.push(replyPayload.text);
        }
        return true;
      },
      sendBlockReply: () => true,
      sendToolResult: () => true,
      waitForIdle: async () => {},
      getQueuedCounts: () => ({ final: 0, block: 0, tool: 0 }),
    },
  });

  return { handled: true, replies };
}
