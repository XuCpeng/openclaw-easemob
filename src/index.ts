/**
 * Easemob Plugin Entry Point
 *
 * This is the main entry point for the OpenClaw Easemob Channel Plugin.
 * It registers the HTTP webhook route and the channel plugin with OpenClaw.
 */

import { easemobPlugin, handleEasemobWebhook } from "./channel.js";
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

          if (api.logger.debug) {
            api.logger.debug(`Easemob webhook received: ${body}`);
          }

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

          // Process the webhook
          const result = await handleEasemobWebhook(
            data,
            api.config,
            // Cast to any because the ChannelAPI interface has additional OpenClaw-specific methods
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            api as any
          );

          // Send replies if message was handled
          if (result.handled && result.replies.length > 0) {
            const to = data.from;
            const accountId = data.to;

            const easemobCfg = api.config.channels?.easemob;
            const accounts = easemobCfg?.accounts || {};
            const matchedAccount = Object.values(accounts).find(
              (acc) => acc?.accountId === accountId
            );

            if (to && accountId && matchedAccount) {
              for (const replyText of result.replies) {
                try {
                  await easemobPlugin.outbound.sendText({
                    to,
                    text: replyText,
                    accountId,
                    cfg: api.config,
                  });
                  api.logger.info(`Easemob reply sent to ${to}`);
                } catch (sendErr) {
                  api.logger.error(`Easemob reply failed: ${sendErr}`);
                }
              }
            } else {
              api.logger.warn(`Easemob: Could not send reply - account not found for ${accountId}`);
            }
          }

          // Return success response
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "ok",
            handled: result.handled,
            replyCount: result.replies.length,
          }));
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

export { easemobPlugin, handleEasemobWebhook } from "./channel.js";
export type {
  EasemobAccountConfig,
  EasemobConfig,
  EasemobToken,
  EasemobWebhookPayload,
} from "./types.js";
export { probeEasemob, getAccessToken } from "./probe.js";
export { easemobOnboardingAdapter } from "./onboarding.js";
