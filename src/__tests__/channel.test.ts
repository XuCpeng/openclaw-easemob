/**
 * Tests for channel.ts - Channel plugin functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as probeModule from "../probe.js";
import { handleEasemobWebhook, easemobPlugin } from "../channel.js";
import type { EasemobWebhookPayload, OpenClawConfig } from "../types.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("handleEasemobWebhook", () => {
  const mockApi = {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    runtime: {
      channel: {
        reply: {
          finalizeInboundContext: vi.fn((ctx) => ctx),
          dispatchReplyFromConfig: vi.fn(),
        },
      },
    },
  };

  const mockConfig: OpenClawConfig = {
    channels: {
      easemob: {
        accounts: {
          test_bot: {
            accountId: "test_bot",
            orgName: "test-org",
            appName: "test-app",
            clientId: "test-id",
            clientSecret: "test-secret",
          },
        },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("should ignore non-direct messages", async () => {
    const payload: EasemobWebhookPayload = {
      chat_type: "groupchat",
      eventType: "chat",
    };

    const result = await handleEasemobWebhook(payload, mockConfig, mockApi);

    expect(result.handled).toBe(false);
    expect(result.replies).toEqual([]);
  });

  it("should ignore non-chat events", async () => {
    const payload: EasemobWebhookPayload = {
      chat_type: "chat",
      eventType: "user_status",
    };

    const result = await handleEasemobWebhook(payload, mockConfig, mockApi);

    expect(result.handled).toBe(false);
    expect(result.replies).toEqual([]);
  });

  it("should ignore messages to unknown recipient", async () => {
    const payload: EasemobWebhookPayload = {
      chat_type: "chat",
      eventType: "chat",
      from: "user123",
      to: "unknown_bot",
      payload: {
        bodies: [{ type: "txt", msg: "Hello" }],
      },
    };

    const result = await handleEasemobWebhook(payload, mockConfig, mockApi);

    expect(result.handled).toBe(false);
    expect(mockApi.logger.info).toHaveBeenCalledWith(
      'Easemob ignored: recipient "unknown_bot" not configured'
    );
  });

  it("should ignore messages without text", async () => {
    const payload: EasemobWebhookPayload = {
      chat_type: "chat",
      eventType: "chat",
      from: "user123",
      to: "test_bot",
      payload: {
        bodies: [{ type: "img" }],
      },
    };

    const result = await handleEasemobWebhook(payload, mockConfig, mockApi);

    expect(result.handled).toBe(false);
  });

  it("should handle valid direct messages", async () => {
    const payload: EasemobWebhookPayload = {
      chat_type: "chat",
      eventType: "chat",
      from: "user123",
      to: "test_bot",
      msg_id: "msg-123",
      payload: {
        bodies: [{ type: "txt", msg: "Hello bot" }],
      },
    };

    mockApi.runtime.channel.reply.dispatchReplyFromConfig.mockImplementation(
      async ({ dispatcher }) => {
        dispatcher.sendFinalReply({ text: "Hi there!" });
      }
    );

    const result = await handleEasemobWebhook(payload, mockConfig, mockApi);

    expect(result.handled).toBe(true);
    expect(result.replies).toEqual(["Hi there!"]);
    expect(mockApi.logger.info).toHaveBeenCalledWith(
      "Easemob received message from user123: Hello bot"
    );
  });

  it("should handle multiple replies", async () => {
    const payload: EasemobWebhookPayload = {
      chat_type: "chat",
      eventType: "receive_message",
      from: "user123",
      to: "test_bot",
      msg_id: "msg-456",
      payload: {
        bodies: [{ type: "txt", msg: "Tell me a story" }],
      },
    };

    mockApi.runtime.channel.reply.dispatchReplyFromConfig.mockImplementation(
      async ({ dispatcher }) => {
        dispatcher.sendFinalReply({ text: "Once upon a time..." });
        dispatcher.sendFinalReply({ text: "The end." });
      }
    );

    const result = await handleEasemobWebhook(payload, mockConfig, mockApi);

    expect(result.handled).toBe(true);
    expect(result.replies).toHaveLength(2);
    expect(result.replies).toContain("Once upon a time...");
    expect(result.replies).toContain("The end.");
  });

  it("should work with call_back_type instead of eventType", async () => {
    const payload: EasemobWebhookPayload = {
      chat_type: "direct",
      call_back_type: "chat",
      from: "user123",
      to: "test_bot",
      msg_id: "msg-789",
      payload: {
        bodies: [{ type: "txt", msg: "Test message" }],
      },
    };

    mockApi.runtime.channel.reply.dispatchReplyFromConfig.mockImplementation(
      async ({ dispatcher }) => {
        dispatcher.sendFinalReply({ text: "Received!" });
      }
    );

    const result = await handleEasemobWebhook(payload, mockConfig, mockApi);

    expect(result.handled).toBe(true);
    expect(result.replies).toEqual(["Received!"]);
  });
});

describe("easemobPlugin config methods", () => {
  const mockConfig: OpenClawConfig = {
    channels: {
      easemob: {
        accounts: {
          account1: {
            accountId: "account1",
            orgName: "org1",
            appName: "app1",
            clientId: "id1",
            clientSecret: "secret1",
            enabled: true,
            name: "Test Account",
          },
          account2: {
            accountId: "account2",
            orgName: "org2",
            appName: "app2",
            clientId: "id2",
            clientSecret: "secret2",
          },
        },
      },
    },
  };

  it("should list all account IDs", () => {
    const ids = easemobPlugin.config.listAccountIds(mockConfig);
    expect(ids).toContain("account1");
    expect(ids).toContain("account2");
    expect(ids).toHaveLength(2);
  });

  it("should resolve account by ID", () => {
    const account = easemobPlugin.config.resolveAccount(mockConfig, "account1");
    expect(account.accountId).toBe("account1");
    expect(account.name).toBe("Test Account");
  });

  it("should return default account when not found", () => {
    const account = easemobPlugin.config.resolveAccount(mockConfig, "nonexistent");
    expect(account.accountId).toBe("nonexistent");
    expect(account.configured).toBe(false);
    expect(account.enabled).toBe(false);
  });

  it("should get first account as default", () => {
    const defaultId = easemobPlugin.config.defaultAccountId(mockConfig);
    expect(defaultId).toBe("account1");
  });

  it("should return default when no accounts", () => {
    const emptyConfig: OpenClawConfig = { channels: {} };
    const defaultId = easemobPlugin.config.defaultAccountId(emptyConfig);
    expect(defaultId).toBe("default");
  });

  it("should check if account is configured", async () => {
    const configuredAccount = {
      accountId: "test",
      orgName: "org",
      appName: "app",
      clientId: "id",
      clientSecret: "secret",
    };
    const isConfigured = await easemobPlugin.config.isConfigured(configuredAccount);
    expect(isConfigured).toBe(true);

    const unconfigured = await easemobPlugin.config.isConfigured({
      accountId: "test",
      orgName: "",
      appName: "",
      clientId: "",
      clientSecret: "",
    });
    expect(unconfigured).toBe(false);
  });

  it("should check if account is enabled", () => {
    const enabled = easemobPlugin.config.isEnabled({ enabled: true });
    expect(enabled).toBe(true);

    const disabled = easemobPlugin.config.isEnabled({ enabled: false });
    expect(disabled).toBe(false);

    // Default to true when not specified
    const defaultEnabled = easemobPlugin.config.isEnabled({});
    expect(defaultEnabled).toBe(true);
  });

  it("should describe account", () => {
    const description = easemobPlugin.config.describeAccount({
      accountId: "test",
      name: "Display Name",
      enabled: true,
      orgName: "org",
      appName: "app",
      clientId: "id",
      clientSecret: "secret",
    });
    expect(description.accountId).toBe("test");
    expect(description.name).toBe("Display Name");
    expect(description.enabled).toBe(true);
    expect(description.configured).toBe(true);
  });

  it("should use accountId as name fallback", () => {
    const description = easemobPlugin.config.describeAccount({
      accountId: "test",
    });
    expect(description.name).toBe("test");
  });

  it("should resolve allowFrom", () => {
    const mockCfg: OpenClawConfig = {
      channels: {
        easemob: {
          accounts: {
            test: {
              accountId: "test",
              orgName: "org",
              appName: "app",
              clientId: "id",
              clientSecret: "secret",
              allowFrom: ["user1", "USER2", 123],
            },
          },
        },
      },
    };

    const allowed = easemobPlugin.config.resolveAllowFrom({
      cfg: mockCfg,
      accountId: "test",
    });

    expect(allowed).toEqual(["user1", "user2", "123"]);
  });

  it("should return empty array for missing allowFrom", () => {
    const allowed = easemobPlugin.config.resolveAllowFrom({
      cfg: mockConfig,
      accountId: "account1",
    });
    expect(allowed).toEqual([]);
  });

  it("should format allowFrom", () => {
    const formatted = easemobPlugin.config.formatAllowFrom({
      allowFrom: ["USER1", "  user2  ", 456],
    });

    expect(formatted).toEqual(["user1", "user2", "456"]);
  });

  it("should handle empty allowFrom", () => {
    const formatted = easemobPlugin.config.formatAllowFrom({ allowFrom: [] });
    expect(formatted).toEqual([]);
  });
});

describe("easemobPlugin security", () => {
  it("should warn about open DM policy", () => {
    const mockCfg: OpenClawConfig = {
      channels: {
        easemob: {
          accounts: {
            test: {
              accountId: "test",
              orgName: "org",
              appName: "app",
              clientId: "id",
              clientSecret: "secret",
              dmPolicy: "open",
            },
          },
        },
      },
    };

    const warnings = easemobPlugin.security.collectWarnings({
      cfg: mockCfg,
      accountId: "test",
    });

    expect(warnings).toContain(
      "Easemob DM policy is 'open' - any user can send messages to the agent"
    );
  });

  it("should warn about missing account", () => {
    const mockCfg: OpenClawConfig = { channels: {} };

    const warnings = easemobPlugin.security.collectWarnings({
      cfg: mockCfg,
      accountId: "test",
    });

    expect(warnings).toContain("Easemob account not configured");
  });

  it("should not warn for pairing policy", () => {
    const mockCfg: OpenClawConfig = {
      channels: {
        easemob: {
          accounts: {
            test: {
              accountId: "test",
              orgName: "org",
              appName: "app",
              clientId: "id",
              clientSecret: "secret",
              dmPolicy: "pairing",
            },
          },
        },
      },
    };

    const warnings = easemobPlugin.security.collectWarnings({
      cfg: mockCfg,
      accountId: "test",
    });

    expect(warnings).not.toContain(
      "Easemob DM policy is 'open' - any user can send messages to the agent"
    );
  });
});

describe("easemobPlugin outbound.sendText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("should return error when account not found", async () => {
    const result = await easemobPlugin.outbound.sendText({
      to: "user123",
      text: "Hello",
      accountId: "nonexistent",
      cfg: { channels: {} },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Account not found");
  });

  it("should send message successfully", async () => {
    const mockConfig: OpenClawConfig = {
      channels: {
        easemob: {
          accounts: {
            test: {
              accountId: "test",
              orgName: "test-org",
              appName: "test-app",
              clientId: "test-id",
              clientSecret: "test-secret",
            },
          },
        },
      },
    };

    // Spy on getAccessToken to return test token
    const getAccessTokenSpy = vi.spyOn(probeModule, "getAccessToken")
      .mockResolvedValue("test-token");

    // Mock send message endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: "msg-123" }),
    });

    const result = await easemobPlugin.outbound.sendText({
      to: "user123",
      text: "Hello",
      accountId: "test",
      cfg: mockConfig,
    });

    expect(getAccessTokenSpy).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.channel).toBe("easemob");
    expect(result.messageId).toBe("msg-123");

    getAccessTokenSpy.mockRestore();
  });

  it("should handle send failure", async () => {
    const mockConfig: OpenClawConfig = {
      channels: {
        easemob: {
          accounts: {
            test: {
              accountId: "test",
              orgName: "test-org",
              appName: "test-app",
              clientId: "test-id",
              clientSecret: "test-secret",
            },
          },
        },
      },
    };

    // Spy on getAccessToken to return test token
    const getAccessTokenSpy = vi.spyOn(probeModule, "getAccessToken")
      .mockResolvedValue("test-token");

    // Mock send message endpoint - failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error_description: "Invalid recipient" }),
    });

    const result = await easemobPlugin.outbound.sendText({
      to: "user123",
      text: "Hello",
      accountId: "test",
      cfg: mockConfig,
    });

    expect(getAccessTokenSpy).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid recipient");

    getAccessTokenSpy.mockRestore();
  });
});
