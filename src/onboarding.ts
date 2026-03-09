/**
 * Easemob Channel Onboarding Adapter
 */

import type { EasemobAccountConfig, EasemobConfig, OpenClawConfig } from "./types.js";
import { probeEasemob } from "./probe.js";

const DEFAULT_ACCOUNT_ID = "default";
const CHANNEL_ID = "easemob" as const;

function formatDocsLink(path: string, label: string): string {
  return `https://docs.openclaw.ai${path}`;
}

function setEasemobDmPolicy(
  cfg: OpenClawConfig,
  dmPolicy: "open" | "pairing" | "allowlist"
): OpenClawConfig {
  const easemobCfg = cfg.channels?.[CHANNEL_ID] as EasemobConfig | undefined;
  const accountId = Object.keys(easemobCfg?.accounts ?? {})[0] || DEFAULT_ACCOUNT_ID;

  const accounts = { ...easemobCfg?.accounts };
  const account = accounts?.[accountId];

  if (account) {
    accounts[accountId] = { ...account, dmPolicy };
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_ID]: {
        ...cfg.channels?.[CHANNEL_ID],
        accounts,
      },
    },
  };
}

function setEasemobAllowFrom(cfg: OpenClawConfig, allowFrom: string[]): OpenClawConfig {
  const easemobCfg = cfg.channels?.[CHANNEL_ID] as EasemobConfig | undefined;
  const accountId = Object.keys(easemobCfg?.accounts ?? {})[0] || DEFAULT_ACCOUNT_ID;

  const accounts = { ...easemobCfg?.accounts };
  const account = accounts?.[accountId];

  if (account) {
    accounts[accountId] = { ...account, allowFrom: allowFrom.map(String) };
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_ID]: {
        ...cfg.channels?.[CHANNEL_ID],
        accounts,
      },
    },
  };
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showCredentialHelp(prompter: any): Promise<void> {
  await prompter.note(
    [
      "📋 Easemob 配置步骤:",
      "",
      "1) 登录环信控制台: https://console.easemob.com",
      "2) 创建或选择一个应用",
      "3) 在「应用概览」中获取:",
      "   - OrgName (组织名称)",
      "   - AppName (应用名称)",
      "   - Client ID",
      "   - Client Secret",
      "4) 在「用户认证」中创建一个用户作为机器人账号",
      "",
      `📖 文档: ${formatDocsLink("/channels/easemob", "easemob")}`,
    ].join("\n"),
    "Easemob Credentials Help"
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function promptEasemobAllowFrom({
  cfg,
  prompter,
}: {
  cfg: OpenClawConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prompter: any;
}): Promise<OpenClawConfig> {
  const easemobCfg = cfg.channels?.[CHANNEL_ID] as EasemobConfig | undefined;
  const accountId = Object.keys(easemobCfg?.accounts ?? {})[0] || DEFAULT_ACCOUNT_ID;

  const account = easemobCfg?.accounts?.[accountId];
  const existing = account?.allowFrom ?? [];

  await prompter.note(
    [
      "设置允许列表 (Allowlist)",
      "只有列表中的用户可以与机器人私聊",
      "",
      "格式: 每行一个用户名，或使用逗号分隔",
      "示例:",
      "  user1",
      "  user2, user3",
    ].join("\n"),
    "Easemob Allowlist"
  );

  while (true) {
    const entry = await prompter.text({
      message: "输入允许的用户名",
      placeholder: "user1, user2, ...",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value: string | undefined) => (String(value ?? "").trim() ? undefined : "至少输入一个用户"),
    });

    const parts = parseAllowFromInput(String(entry));
    if (parts.length === 0) {
      await prompter.note("请至少输入一个有效的用户名", "Easemob Allowlist");
      continue;
    }

    const unique = [
      ...new Set([...existing.map((v) => String(v).trim()).filter(Boolean), ...parts]),
    ];

    return setEasemobAllowFrom(cfg, unique);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const easemobOnboardingAdapter: any = {
  channel: CHANNEL_ID,

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStatus: async ({ cfg }: { cfg: OpenClawConfig }) => {
    const easemobCfg = cfg.channels?.[CHANNEL_ID] as EasemobConfig | undefined;
    const accountId = Object.keys(easemobCfg?.accounts ?? {})[0];
    const account = accountId ? easemobCfg?.accounts?.[accountId] : undefined;

    const configured = Boolean(
      account?.clientId && account?.clientSecret && account?.orgName && account?.appName
    );

    let probeResult: { ok: boolean; error?: string } | null = null;
    if (configured && account) {
      probeResult = await probeEasemob(account);
    }

    const statusLines: string[] = [];
    if (!configured) {
      statusLines.push("Easemob: 需要配置应用凭据");
    } else if (probeResult?.ok) {
      statusLines.push(`Easemob: 已连接 (${account?.accountId})`);
    } else {
      statusLines.push(`Easemob: 已配置 (未验证连接)`);
      if (probeResult?.error) {
        statusLines.push(`  错误: ${probeResult.error}`);
      }
    }

    return {
      channel: CHANNEL_ID,
      configured,
      statusLines,
      selectionHint: configured ? "已配置" : "需要配置",
      quickstartScore: configured ? 2 : 0,
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configure: async ({ cfg, prompter }: { cfg: OpenClawConfig; prompter: any }) => {
    const easemobCfg = cfg.channels?.[CHANNEL_ID] as EasemobConfig | undefined;
    const existingAccount = Object.values(easemobCfg?.accounts ?? {})[0];

    if (!existingAccount) {
      await showCredentialHelp(prompter);
    }

    const orgName = String(
      await prompter.text({
        message: "输入 Easemob OrgName",
        initialValue: existingAccount?.orgName,
        validate: (v: string | undefined) => (v?.trim() ? undefined : "OrgName 不能为空"),
      })
    ).trim();

    const appName = String(
      await prompter.text({
        message: "输入 Easemob AppName",
        initialValue: existingAccount?.appName,
        validate: (v: string | undefined) => (v?.trim() ? undefined : "AppName 不能为空"),
      })
    ).trim();

    const clientId = String(
      await prompter.text({
        message: "输入 Easemob Client ID",
        initialValue: existingAccount?.clientId,
        validate: (v: string | undefined) => (v?.trim() ? undefined : "Client ID 不能为空"),
      })
    ).trim();

    const clientSecret = String(
      await prompter.text({
        message: "输入 Easemob Client Secret",
        initialValue: existingAccount?.clientSecret,
        validate: (v: string | undefined) => (v?.trim() ? undefined : "Client Secret 不能为空"),
      })
    ).trim();

    const agentUsername = String(
      await prompter.text({
        message: "输入机器人 Easemob 用户名",
        initialValue: existingAccount?.accountId,
        validate: (v: string | undefined) => (v?.trim() ? undefined : "用户名不能为空"),
      })
    ).trim();

    const account: EasemobAccountConfig = {
      accountId: agentUsername,
      orgName,
      appName,
      clientId,
      clientSecret,
      enabled: true,
    };

    // 使用 DEFAULT_ACCOUNT_ID ("default") 作为账号键，保持与其他 Channel 一致
    const accounts: Record<string, EasemobAccountConfig> = {};
    accounts[DEFAULT_ACCOUNT_ID] = account;

    const next = {
      ...cfg,
      channels: {
        ...cfg.channels,
        [CHANNEL_ID]: {
          accounts,
        },
      },
    };

    try {
      const probe = await probeEasemob(account);
      if (probe.ok) {
        await prompter.note(
          `✅ 连接成功！已验证用户 ${agentUsername}`,
          "Easemob Connection Test"
        );
      } else {
        await prompter.note(
          `⚠️ 连接失败: ${probe.error ?? "未知错误"}\n\n请检查配置是否正确。`,
          "Easemob Connection Test"
        );
      }
    } catch (err) {
      await prompter.note(
        `⚠️ 连接测试失败: ${err instanceof Error ? err.message : String(err)}`,
        "Easemob Connection Test"
      );
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  dmPolicy: {
    label: "Easemob",
    channel: CHANNEL_ID,
    policyKey: "channels.easemob.dmPolicy",
    allowFromKey: "channels.easemob.allowFrom",

    getCurrent: (cfg: OpenClawConfig) => {
      const easemobCfg = cfg.channels?.[CHANNEL_ID] as EasemobConfig | undefined;
      const accountId = Object.keys(easemobCfg?.accounts ?? {})[0];

      if (!accountId) return "pairing";

      return easemobCfg?.accounts?.[accountId]?.dmPolicy ?? "pairing";
    },

    setPolicy: (cfg: OpenClawConfig, policy: "open" | "pairing" | "allowlist") =>
      setEasemobDmPolicy(cfg, policy),

    promptAllowFrom: promptEasemobAllowFrom,
  },

  disable: (cfg: OpenClawConfig) => {
    const easemobCfg = cfg.channels?.[CHANNEL_ID] as EasemobConfig | undefined;
    const accountId = Object.keys(easemobCfg?.accounts ?? {})[0] || DEFAULT_ACCOUNT_ID;

    const accounts = { ...easemobCfg?.accounts };
    const account = accounts?.[accountId];

    if (account) {
      accounts[accountId] = { ...account, enabled: false };
    }

    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [CHANNEL_ID]: {
          ...cfg.channels?.[CHANNEL_ID],
          accounts,
        },
      },
    };
  },
};
