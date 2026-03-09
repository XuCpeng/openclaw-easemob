/**
 * Easemob Connection Probe and Token Management
 *
 * This module handles:
 * - OAuth2 token acquisition and caching
 * - Connection health checking
 * - File upload to Easemob
 */

import type { EasemobAccountConfig, EasemobToken } from "./types.js";

/**
 * Result of probing an Easemob account connection
 */
export type EasemobProbeResult = {
  ok: boolean;
  error?: string;
};

/** In-memory cache for access tokens, keyed by account identifier */
const tokenCache = new Map<string, EasemobToken>();

/**
 * Gets an access token for the given Easemob account.
 * Returns cached token if valid, otherwise fetches a new one.
 *
 * @param account - The Easemob account configuration
 * @returns The access token string
 * @throws Error if token acquisition fails
 */
export async function getAccessToken(account: EasemobAccountConfig): Promise<string> {
  const cacheKey = `${account.orgName}/${account.appName}/${account.clientId}`;
  const cached = tokenCache.get(cacheKey);

  // Return cached token if it has more than 60 seconds remaining
  if (cached && cached.expires_at > Date.now() + 60000) {
    return cached.access_token;
  }

  const url = `https://a1.easemob.com/${account.orgName}/${account.appName}/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: account.clientId,
      client_secret: account.clientSecret,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Easemob token error: ${response.status} ${errText}`);
  }

  const data = await response.json() as {
    access_token: string;
    expires_in: number;
  };

  const token: EasemobToken = {
    access_token: data.access_token,
    expires_in: data.expires_in,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  tokenCache.set(cacheKey, token);
  return token.access_token;
}

/**
 * Clears the token cache for a specific account or all accounts.
 *
 * @param account - Optional account to clear cache for. If omitted, clears all cached tokens.
 */
export function clearTokenCache(account?: EasemobAccountConfig): void {
  if (account) {
    const cacheKey = `${account.orgName}/${account.appName}/${account.clientId}`;
    tokenCache.delete(cacheKey);
  } else {
    tokenCache.clear();
  }
}

/**
 * Probes the Easemob connection by attempting to get a token and verify the account user exists.
 *
 * @param account - The Easemob account configuration to test
 * @returns Probe result indicating success or failure with error message
 */
export async function probeEasemob(account: EasemobAccountConfig): Promise<EasemobProbeResult> {
  try {
    const token = await getAccessToken(account);
    const url = `https://a1.easemob.com/${account.orgName}/${account.appName}/users/${account.accountId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok && response.status !== 404) {
      const data = await response.json() as { error_description?: string };
      return { ok: false, error: data.error_description || response.statusText };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Uploads a file to Easemob's chat file storage.
 *
 * @param account - The Easemob account configuration
 * @param fileBuffer - The file content as a Buffer
 * @param filename - The original filename
 * @param mimeType - The MIME type of the file
 * @returns Object containing the file UUID and secret for sharing
 * @throws Error if upload fails
 */
export async function uploadFileToEasemob(
  account: EasemobAccountConfig,
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ uuid: string; secret: string }> {
  const token = await getAccessToken(account);
  const url = `https://a1.easemob.com/${account.orgName}/${account.appName}/chatfiles`;

  const blob = new Blob([fileBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("file", blob, filename);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "restrict-access": "true",
    },
    body: formData,
  });

  if (!response.ok) {
    const errData = await response.json() as { error_description?: string };
    throw new Error(`Easemob upload failed: ${errData.error_description || response.statusText}`);
  }

  const data = await response.json() as {
    entities: Array<{ uuid: string; "share-secret": string }>;
  };

  const entity = data.entities[0];
  return {
    uuid: entity.uuid,
    secret: entity["share-secret"],
  };
}
