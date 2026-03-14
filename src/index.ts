/**
 * Easemob Plugin Entry Point
 *
 * This is the main entry point for the OpenClaw Easemob Channel Plugin.
 * It registers the HTTP webhook route and the channel plugin with OpenClaw.
 */

import { easemobPlugin } from "./channel.js";
import type { EasemobWebhookPayload, EasemobAccountConfig } from "./types.js";
import os from "node:os";
import path from "node:path";

/** HTTP request object */
interface HttpRequest {
  method: string;
  [Symbol.asyncIterator](): AsyncIterableIterator<string>;
}

/** HTTP response object */
interface HttpResponse {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  end(data: string): void;
}

/** Plugin API interface */
interface PluginAPI {
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    warn: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  config: {
    channels?: {
      easemob?: {
        accounts?: Record<string, EasemobAccountConfig>;
      };
    };
  };
  runtime: {
    channel: {
      reply: {
        finalizeInboundContext: (ctx: any) => any;
        dispatchReplyFromConfig: (params: {
          cfg: any;
          ctx: any;
          dispatcher: any;
        }) => Promise<void>;
      };
    };
  };
  registerHttpRoute: (route: {
    path: string;
    auth: "gateway" | "plugin";
    handler: (req: HttpRequest, res: HttpResponse) => Promise<void>;
  }) => void;
  registerChannel: (params: { plugin: typeof easemobPlugin }) => void;
}

/** Plugin manifest */
const plugin = {
  id: "openclaw-easemob",
  name: "Easemob",
  description: "Easemob (环信IM) channel plugin for OpenClaw",
  version: "1.0.0",

  configSchema: undefined as unknown,

  /**
   * Registers the plugin with OpenClaw
   *
   * @param api - The plugin API provided by OpenClaw
   */
  register(api: PluginAPI): void {
    api.logger.info("OpenClaw Easemob plugin v1.0.0 loaded");

    // Register webhook endpoint for receiving messages
    api.registerHttpRoute({
      path: "/webhooks/easemob",
      auth: "plugin",
      handler: async (req: HttpRequest, res: HttpResponse) => {
        // Only accept POST requests
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
          return;
        }

        try {
          // Read request body
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }

          api.logger.info(`Easemob webhook received: ${body}`);

          // Parse JSON payload
          let data: EasemobWebhookPayload;
          try {
            data = JSON.parse(body);
          } catch (parseErr) {
            api.logger.error(`Easemob webhook JSON parse error: ${parseErr}`);
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          const eventType = data.eventType || data.call_back_type;
          const chatType = data.chat_type;
          const from = data.from;
          const to = data.to;

          // Only handle direct chat messages
          if (chatType !== "chat" && chatType !== "direct") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored", reason: "not chat" }));
            return;
          }

          if (eventType !== "chat" && eventType !== "receive_message") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored", reason: "not message event" }));
            return;
          }

          const cfg = api.config;
          const accounts = (cfg.channels?.easemob as any)?.accounts || {};
          const matchedAccount = Object.values(accounts).find(
            (acc: any) => acc?.accountId === to
          );

          if (!matchedAccount) {
            api.logger.info(`Easemob ignored: recipient "${to}" not configured`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored", reason: "account not configured" }));
            return;
          }

          const text = data.payload?.bodies?.[0]?.msg;

          if (!text || !from) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored", reason: "no text or from" }));
            return;
          }

          api.logger.info(`Easemob processing message from ${from}: ${text}`);

          // 获取账号配置
          const account = matchedAccount as EasemobAccountConfig;
          // showToolCalls: "off" | "on" | "full"，默认 "off"
          const showToolCalls = account.showToolCalls ?? "off";
          const verboseLevel = showToolCalls === "off" ? undefined : showToolCalls;

            api.logger.info(`[Easemob Debug] Account: ${JSON.stringify({
              accountId: account.accountId,
              showToolCalls: account.showToolCalls,
              verboseLevel,
            })}`);

            // 1. 构造并标准化上下文
            const rawCtx = {
              From: from,
              To: to,
              Body: text,
              ChatType: "direct" as const,
              MessageSid: data.msg_id,
              Surface: "easemob",
              Provider: "easemob",
              WasMentioned: true,
              raw: data,
            };
            const finalizedCtx = api.runtime.channel.reply.finalizeInboundContext(rawCtx);

            // 补丁：手动确保 SessionKey 存在
            if (!finalizedCtx.SessionKey) {
              finalizedCtx.SessionKey = `agent:main:easemob:direct:${from.toLowerCase()}`;
            }

            // 如果 showToolCalls 不是 "off"，设置 session 的 verboseLevel
            if (verboseLevel && finalizedCtx.SessionKey) {
              try {
                const homedir = os.homedir();
                const sessionStorePath = path.join(homedir, ".openclaw", "agents", "main", "sessions", "sessions.json");
                const fs = await import("node:fs");
                let store: Record<string, any> = {};
                try {
                  const raw = fs.readFileSync(sessionStorePath, "utf-8");
                  store = JSON.parse(raw);
                } catch {
                  // 文件不存在或解析失败，使用空对象
                }
                const entry = store[finalizedCtx.SessionKey] || {};
                if (entry.verboseLevel !== verboseLevel) {
                  entry.verboseLevel = verboseLevel;
                  store[finalizedCtx.SessionKey] = entry;
                  fs.writeFileSync(sessionStorePath, JSON.stringify(store, null, 2));
                  api.logger.info(`[Easemob Debug] Set verboseLevel to "${verboseLevel}" for session ${finalizedCtx.SessionKey}`);
                }
              } catch (err) {
                api.logger.error(`[Easemob Debug] Failed to set verboseLevel: ${err}`);
              }
            }

            api.logger.info(
              `Easemob context: SessionKey=${finalizedCtx.SessionKey}, AccountId=${finalizedCtx.AccountId}, showToolCalls=${showToolCalls}`,
            );

            // 2. 收集 AI 所有的回复片段
            const fullReplyPayloads: any[] = [];
            const toolResults: any[] = [];

            // 发送消息到用户的辅助函数
            const sendMessageToUser = async (messageText: string) => {
              if (!messageText?.trim()) return;
              try {
                await (easemobPlugin as any).outbound.sendText({
                  to: from,
                  text: messageText,
                  accountId: to,
                  cfg,
                });
              } catch (err) {
                api.logger.error(`Easemob send message error: ${err}`);
              }
            };

            // 3. 运行 AI 引擎（异步执行，不阻塞响应）
            void (async () => {
              try {
                await api.runtime.channel.reply.dispatchReplyFromConfig({
                  cfg,
                  ctx: finalizedCtx,
                  // 自定义分发器
                  dispatcher: {
                    sendFinalReply: (payload: any) => {
                      fullReplyPayloads.push(payload);
                      return true;
                    },
                    sendBlockReply: (payload: any) => {
                      // 累加流式块到结果中
                      fullReplyPayloads.push(payload);
                      return true;
                    },
                    sendToolResult: (payload: any) => {
                      api.logger.info(`[Easemob Debug] sendToolResult called: showToolCalls=${showToolCalls}, hasText=${Boolean(payload.text)}, payloadKeys=${Object.keys(payload).join(",")}`);
                      if (showToolCalls !== "off" && payload.text) {
                        // 实时发送工具调用详情给用户
                        toolResults.push(payload);
                        api.logger.info(`[Easemob Debug] Sending tool result to user: ${payload.text.substring(0, 100)}...`);
                        // 异步发送，不阻塞流程
                        void sendMessageToUser(payload.text);
                      }
                      return true;
                    },
                    waitForIdle: async () => {},
                    getQueuedCounts: () => ({ final: fullReplyPayloads.length, block: 0, tool: toolResults.length }),
                  } as any,
                });

                // 4. 一次性合并发送所有收集到的最终回复
                const combinedText = fullReplyPayloads
                  .map((p) => p.text)
                  .filter(Boolean)
                  .join("\n\n")
                  .trim();

                if (combinedText) {
                  api.logger.info(`Easemob sending combined reply to ${from}: ${combinedText.substring(0, 100)}...`);
                  await (easemobPlugin as any).outbound.sendText({
                    to: from,
                    text: combinedText,
                    accountId: to,
                    cfg,
                  });
                }

                api.logger.info(`Easemob processing completed. Final replies: ${fullReplyPayloads.length}, Tool results: ${toolResults.length}`);
              } catch (flowErr) {
                api.logger.error(
                  `Easemob flow error: ${flowErr instanceof Error ? flowErr.stack : String(flowErr)}`,
                );
              }
            })();

            // 立即返回成功响应（不等待 AI 处理完成）
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
          } catch (err) {
            api.logger.error(`Easemob webhook error: ${err}`);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: "Internal Server Error",
              message: err instanceof Error ? err.message : String(err),
            }));
          }
        },
      });

    // Register the channel plugin
    api.registerChannel({ plugin: easemobPlugin });

    api.logger.info("Easemob channel registered successfully");
  },
};

export default plugin;

export { easemobPlugin } from "./channel.js";
export type {
  EasemobAccountConfig,
  EasemobConfig,
  EasemobToken,
  EasemobWebhookPayload,
} from "./types.js";
export { probeEasemob, getAccessToken } from "./probe.js";
export { easemobOnboardingAdapter } from "./onboarding.js";
