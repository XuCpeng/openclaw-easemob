/**
 * Easemob Plugin Types
 *
 * Type definitions for the OpenClaw Easemob Channel Plugin.
 * This plugin enables AI agents to communicate through the Easemob (环信) IM platform.
 */

import type { z } from "zod";

// Re-export zod for use in other modules
export { z };

/**
 * Zod schema for validating Easemob account configuration
 */
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

/**
 * Type for Easemob account configuration
 */
export type EasemobAccountConfig = z.infer<typeof EasemobAccountConfigSchema>;

/**
 * Configuration structure for Easemob channel
 */
export interface EasemobConfig {
  accounts?: Record<string, EasemobAccountConfig>;
}

/**
 * OAuth2 token response from Easemob API
 */
export interface EasemobToken {
  access_token: string;
  expires_in: number;
  expires_at: number;
}

/**
 * Payload structure for Easemob webhook callbacks
 */
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

/**
 * Generic API response wrapper for Easemob API calls
 */
export interface EasemobApiResponse<T = unknown> {
  data?: T;
  error?: string;
  error_description?: string;
}

/**
 * Supported message types in Easemob
 */
export type EasemobMessageType = "txt" | "img" | "audio" | "video" | "file";

/**
 * Request body for sending messages via Easemob REST API
 */
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

/**
 * OpenClaw configuration type (simplified)
 *
 * This is a minimal type definition for the OpenClaw configuration structure.
 * The actual structure is more complex and defined in the openclaw package.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenClawConfig = any;
