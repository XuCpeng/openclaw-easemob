/**
 * Easemob Plugin Entry Point
 *
 * This is the main entry point for the OpenClaw Easemob Channel Plugin.
 * It registers the HTTP webhook route and the channel plugin with OpenClaw.
 */

import { easemobPlugin } from "./channel.js";
import type { EasemobWebhookPayload, EasemobAccountConfig } from "./types.js";

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
  id: "easemob",
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
    api.logger.info("Easemob plugin v1.0.0 loaded");

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

          try {
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

            api.logger.info(
              `Easemob context: SessionKey=${finalizedCtx.SessionKey}, AccountId=${finalizedCtx.AccountId}`,
            );

            // 2. 收集 AI 所有的回复片段
            const fullReplyPayloads: any[] = [];

            // 3. 运行 AI 引擎
            await api.runtime.channel.reply.dispatchReplyFromConfig({
              cfg,
              ctx: finalizedCtx,
              // 自定义分发器：只收集结果，不立即发送
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
                sendToolResult: () => true,
                waitForIdle: async () => {},
                getQueuedCounts: () => ({ final: 0, block: 0, tool: 0 }),
              } as any,
            });

            // 4. 一次性合并发送所有收集到的文本
            const combinedText = fullReplyPayloads
              .map((p) => p.text)
              .filter(Boolean)
              .join("\n\n")
              .trim();

            if (combinedText) {
              api.logger.info(`Easemob sending combined reply to ${from}: ${combinedText}`);
              // 使用 to (xcp_claw_test) 作为 accountId，getAccount 会通过字段值查找
              await (easemobPlugin as any).outbound.sendText({
                to: from,
                text: combinedText,
                accountId: to,
                cfg,
              });
            }

            api.logger.info(`Easemob processing completed.`);
          } catch (flowErr) {
            api.logger.error(
              `Easemob flow error: ${flowErr instanceof Error ? flowErr.stack : String(flowErr)}`,
            );
          }

          // Return success response
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
