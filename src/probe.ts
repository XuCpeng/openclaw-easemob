/**
 * Easemob Connection Probe
 */

import type { EasemobAccountConfig, EasemobToken } from "./types.js";

export type EasemobProbeResult = {
  ok: boolean;
  error?: string;
};

const tokenCache = new Map<string, EasemobToken>();

export async function getAccessToken(account: EasemobAccountConfig): Promise<string> {
  const cacheKey = `${account.orgName}/${account.appName}/${account.clientId}`;
  const cached = tokenCache.get(cacheKey);

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

export function clearTokenCache(account?: EasemobAccountConfig): void {
  if (account) {
    const cacheKey = `${account.orgName}/${account.appName}/${account.clientId}`;
    tokenCache.delete(cacheKey);
  } else {
    tokenCache.clear();
  }
}

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
