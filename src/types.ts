/**
 * Easemob Plugin Types
 */

import { z } from "zod";

export const EasemobAccountConfigSchema = z.object({
  accountId: z.string(),
  orgName: z.string(),
  appName: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
  enabled: z.boolean().default(true).optional(),
  name: z.string().optional(),
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
});

export type EasemobAccountConfig = z.infer<typeof EasemobAccountConfigSchema>;

export interface EasemobConfig {
  accounts?: Record<string, EasemobAccountConfig>;
}

export interface EasemobToken {
  access_token: string;
  expires_in: number;
  expires_at: number;
}

export interface EasemobWebhookPayload {
  call_back_type?: string;
  eventType?: string;
  chat_type?: string;
  from?: string;
  to?: string;
  msg_id?: string;
  timestamp?: number;
  payload?: {
    bodies?: Array<{
      type: string;
      msg?: string;
      url?: string;
      filename?: string;
    }>;
  };
}

export interface EasemobApiResponse<T = unknown> {
  data?: T;
  error?: string;
  error_description?: string;
}

export type EasemobMessageType = "txt" | "img" | "audio" | "video" | "file";

export interface EasemobSendMessageRequest {
  target_type: "users" | "chatgroups";
  target: string[];
  msg: {
    type: EasemobMessageType;
    msg?: string;
    url?: string;
    filename?: string;
    secret?: string;
  };
  from?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenClawConfig = any;
