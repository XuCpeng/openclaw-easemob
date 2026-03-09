/**
 * Easemob Plugin Entry Point
 */

import { easemobPlugin, handleEasemobWebhook } from "./channel.js";
import type { EasemobWebhookPayload } from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApi = any;

const plugin = {
  id: "easemob",
  name: "Easemob",
  description: "Easemob (环信IM) channel plugin for OpenClaw",
  version: "1.0.0",

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configSchema: (undefined as any),

  register(api: AnyApi) {
    api.logger.info("Easemob plugin v1.0.0 loaded");

    api.registerHttpRoute({
      path: "/webhooks/easemob",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
          return;
        }

        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }

          if (api.logger.debug) {
            api.logger.debug(`Easemob webhook received: ${body}`);
          }

          let data: EasemobWebhookPayload;
          try {
            data = JSON.parse(body);
          } catch (parseErr) {
            api.logger.error(`Easemob webhook JSON parse error: ${parseErr}`);
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          const result = await handleEasemobWebhook(
            data,
            api.config,
            api
          );

          if (result.handled && result.replies.length > 0) {
            const to = data.from;
            const accountId = data.to;

            const easemobCfg = api.config.channels?.easemob;
            const accounts = easemobCfg?.accounts || {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const matchedAccount = Object.values(accounts).find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (acc: any) => acc?.accountId === accountId
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
