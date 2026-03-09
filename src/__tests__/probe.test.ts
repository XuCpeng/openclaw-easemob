/**
 * Tests for probe.ts - Token management and connection probing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAccessToken,
  clearTokenCache,
  probeEasemob,
  uploadFileToEasemob,
} from "../probe.js";
import type { EasemobAccountConfig } from "../types.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock Date.now for predictable token expiration tests
const mockNow = 1000000000000;

// Sample account configuration
const mockAccount: EasemobAccountConfig = {
  accountId: "test_bot",
  orgName: "test-org",
  appName: "test-app",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

describe("getAccessToken", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.spyOn(Date, "now").mockReturnValue(mockNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch new token when cache is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "test-token-123",
        expires_in: 3600,
      }),
    });

    const token = await getAccessToken(mockAccount);

    expect(token).toBe("test-token-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://a1.easemob.com/test-org/test-app/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: "test-client-id",
          client_secret: "test-client-secret",
        }),
      }
    );
  });

  it("should return cached token when valid", async () => {
    // First call to populate cache
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "cached-token",
        expires_in: 3600,
      }),
    });

    await getAccessToken(mockAccount);

    // Second call should use cache
    const token = await getAccessToken(mockAccount);

    expect(token).toBe("cached-token");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should fetch new token when cached token expires within 60 seconds", async () => {
    // First call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "old-token",
        expires_in: 60, // Expires in 60 seconds
      }),
    });

    await getAccessToken(mockAccount);

    // Move time forward by 1 second (token expires in 59 seconds)
    vi.spyOn(Date, "now").mockReturnValue(mockNow + 1000);

    // Should fetch new token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-token",
        expires_in: 3600,
      }),
    });

    const token = await getAccessToken(mockAccount);

    expect(token).toBe("new-token");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should throw error when token fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(getAccessToken(mockAccount)).rejects.toThrow(
      "Easemob token error: 401 Unauthorized"
    );
  });
});

describe("clearTokenCache", () => {
  beforeEach(() => {
    clearTokenCache();
    mockFetch.mockClear();
  });

  it("should clear specific account token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "token-1",
        expires_in: 3600,
      }),
    });

    await getAccessToken(mockAccount);
    clearTokenCache(mockAccount);

    // Should fetch again after clearing
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "token-2",
        expires_in: 3600,
      }),
    });

    const token = await getAccessToken(mockAccount);
    expect(token).toBe("token-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should clear all tokens when no account specified", async () => {
    const account2: EasemobAccountConfig = {
      ...mockAccount,
      orgName: "test-org-2",
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "token",
        expires_in: 3600,
      }),
    });

    // Fetch tokens for both accounts
    await getAccessToken(mockAccount);
    await getAccessToken(account2);

    // Verify fetches happened
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Clear all tokens
    clearTokenCache();

    // After clearing, both should need new fetches
    mockFetch.mockClear();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-token",
        expires_in: 3600,
      }),
    });

    await getAccessToken(mockAccount);
    await getAccessToken(account2);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("probeEasemob", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  it("should return ok when probe succeeds", async () => {
    // Mock token fetch
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-token",
          expires_in: 3600,
        }),
      })
      // Mock user check
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

    const result = await probeEasemob(mockAccount);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should return ok when user not found (404)", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

    const result = await probeEasemob(mockAccount);

    expect(result.ok).toBe(true);
  });

  it("should return error when API fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error_description: "Server error" }),
      });

    const result = await probeEasemob(mockAccount);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Server error");
  });

  it("should return error on exception", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await probeEasemob(mockAccount);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Network error");
  });
});

describe("uploadFileToEasemob", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  it("should upload file successfully", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: [
            {
              uuid: "file-uuid-123",
              "share-secret": "secret-456",
            },
          ],
        }),
      });

    const fileBuffer = Buffer.from("test file content");
    const result = await uploadFileToEasemob(
      mockAccount,
      fileBuffer,
      "test.txt",
      "text/plain"
    );

    expect(result.uuid).toBe("file-uuid-123");
    expect(result.secret).toBe("secret-456");
  });

  it("should throw error when upload fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error_description: "Invalid file" }),
      });

    await expect(
      uploadFileToEasemob(mockAccount, Buffer.from("test"), "test.txt", "text/plain")
    ).rejects.toThrow("Easemob upload failed: Invalid file");
  });
});
