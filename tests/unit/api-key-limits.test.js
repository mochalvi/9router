import { afterAll, describe, expect, it } from "vitest";
import {
  buildPublicSlug,
  getPeriodStart,
  getTokenUsage,
  getLimitState,
  getResetCountdown,
  formatExpiredDate,
  getLocalDateKey,
} from "../../src/lib/apiKeyLimits/core.js";

process.env.DATA_DIR = `${process.env.TEMP || process.env.TMP || "."}/9router-api-key-limit-tests-${process.pid}-${Date.now()}`;
const limitsDb = await import("../../src/lib/apiKeyLimits/index.js");

describe("api key limit core", () => {
  it("builds a slug from the name and a six-character suffix", () => {
    expect(buildPublicSlug("Customer Premium", () => "a7x92k")).toBe("customer-premium-a7x92k");
  });

  it("uses input plus output tokens instead of trusting total_tokens", () => {
    expect(getTokenUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 1 })).toBe(150);
    expect(getTokenUsage({ input_tokens: 8, output_tokens: 2 })).toBe(10);
    expect(getTokenUsage({ input_tokens: 8, cache_read_input_tokens: 12, output_tokens: 2 })).toBe(22);
    expect(getTokenUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBe(0);
  });

  it("calculates reset periods, countdown, and Indonesian expiry date in server-local time", () => {
    // Thursday 24 Sep 2026, 16:30 server-local time
    const date = new Date(2026, 8, 24, 16, 30);
    expect(getPeriodStart("none", date)).toBe(null);
    expect(getPeriodStart("daily", date)).toBe(new Date(2026, 8, 24).toISOString());
    expect(getPeriodStart("weekly", date)).toBe(new Date(2026, 8, 21).toISOString());
    expect(getPeriodStart("monthly", date)).toBe(new Date(2026, 8, 1).toISOString());
    expect(getResetCountdown("daily", date)).toBe("7 jam");
    expect(getLocalDateKey(date)).toBe("2026-09-24");
    expect(getResetCountdown("none", date)).toBe(null);
    expect(getResetCountdown("monthly", date, "2026-09-25")).toBe(null);
    expect(formatExpiredDate("2026-09-15")).toBe("15 Sep 2026");
  });

  it("blocks inactive, expired, and exhausted limits", () => {
    const now = new Date("2026-09-24T16:30:00.000Z");
    const base = {
      status: "active",
      unlimitedToken: false,
      quotaTokens: 100,
      usedTokens: 40,
      expiredAt: null,
    };
    expect(getLimitState(base, now)).toMatchObject({ allowed: true, remainingTokens: 60 });
    expect(getLimitState({ ...base, status: "disabled" }, now).allowed).toBe(false);
    expect(getLimitState({ ...base, expiredAt: "2026-09-23" }, now).allowed).toBe(false);
    // Expiry date is inclusive through 23:59:59 server-local time on that day
    expect(getLimitState({ ...base, expiredAt: "2026-09-24" }, new Date(2026, 8, 24, 23, 59)).allowed).toBe(true);
    expect(getLimitState({ ...base, expiredAt: "2026-09-24" }, new Date(2026, 8, 25, 0, 0, 1)).allowed).toBe(false);
    expect(getLimitState({ ...base, usedTokens: 100 }, now).allowed).toBe(false);
    expect(getLimitState({ ...base, unlimitedToken: true, usedTokens: 999999 }, now)).toMatchObject({ allowed: true, remainingTokens: null });
  });

  it("persists CRUD and atomically rejects usage beyond quota", async () => {
    const created = await limitsDb.createApiKeyLimit({
      name: "Smoke Customer",
      apiKeyId: "key-1",
      apiKey: "sk-smoke",
      quotaTokens: 100,
      resetPeriod: "daily",
      providerLogos: ["openai", "anthropic"],
      showQuota: false,
    });
    expect(created.slug).toMatch(/^smoke-customer-[a-z0-9]{6}$/);
    expect(created.providerLogos).toEqual(["openai", "anthropic"]);
    expect(created.showQuota).toBe(false);
    const attempts = await Promise.all(Array.from({ length: 10 }, () => limitsDb.recordApiKeyLimitUsage("sk-smoke", { prompt_tokens: 20, completion_tokens: 0 })));
    expect(attempts.filter((result) => result.recorded)).toHaveLength(5);
    expect((await limitsDb.authorizeApiKeyLimit("sk-smoke")).allowed).toBe(false);
    const denied = await limitsDb.apiKeyLimitResponse("sk-smoke");
    expect(denied.status).toBe(503);
    expect((await denied.json()).error.code).toBe("exhausted");
    const reset = await limitsDb.resetApiKeyLimitQuota(created.id);
    expect(reset.usedTokens).toBe(0);
    expect((await limitsDb.authorizeApiKeyLimit("sk-smoke")).allowed).toBe(true);
    expect(await limitsDb.apiKeyLimitResponse("sk-smoke")).toBe(null);
    expect(await limitsDb.apiKeyLimitResponse("sk-no-limit")).toBe(null);
    expect(await limitsDb.apiKeyLimitResponse(null)).toBe(null);
    expect((await limitsDb.updateApiKeyLimit(created.id, { status: "disabled" })).status).toBe("disabled");
    expect(await limitsDb.deleteApiKeyLimit(created.id)).toBe(true);
  });

  it("applies expiry and unlimited status independently of quota", async () => {
    const expired = await limitsDb.createApiKeyLimit({
      name: "Expired Customer",
      apiKeyId: "key-expired",
      apiKey: "sk-expired",
      quotaTokens: 100,
      expiredAt: "2026-09-23",
    });
    expect((await limitsDb.authorizeApiKeyLimit("sk-expired", new Date(2026, 8, 23, 23, 0))).allowed).toBe(true);
    const expiredResult = await limitsDb.authorizeApiKeyLimit("sk-expired", new Date(2026, 8, 24, 0, 0, 1));
    expect(expiredResult).toMatchObject({ allowed: false, reason: "expired" });
    expect((await limitsDb.recordApiKeyLimitUsage("sk-expired", { prompt_tokens: 5, completion_tokens: 0 }, new Date(2026, 8, 24, 1, 0))).recorded).toBe(false);
    const unlimited = await limitsDb.createApiKeyLimit({
      name: "Unlimited Customer",
      apiKeyId: "key-unlimited",
      apiKey: "sk-unlimited",
      unlimitedToken: true,
      quotaTokens: 0,
    });
    expect((await limitsDb.authorizeApiKeyLimit("sk-unlimited")).allowed).toBe(true);
    expect(unlimited.showQuota).toBe(true);
    expect((await limitsDb.recordApiKeyLimitUsage("sk-unlimited", { prompt_tokens: 100000, completion_tokens: 1 })).recorded).toBe(true);
    expect((await limitsDb.updateApiKeyLimit(unlimited.id, { expiredAt: "2026-09-23" })).allowed).toBe(false);
    await limitsDb.deleteApiKeyLimit(expired.id);
    await limitsDb.deleteApiKeyLimit(unlimited.id);
  });
});

describe("api key limit usage hook", () => {
  it("counts usage saved through saveRequestUsage exactly once", async () => {
    const { saveRequestUsage } = await import("../../src/lib/db/repos/usageRepo.js");
    const created = await limitsDb.createApiKeyLimit({
      name: "Hook Customer",
      apiKeyId: "key-hook",
      apiKey: "sk-hook",
      quotaTokens: 1000,
    });
    const entry = { provider: "openai", model: "gpt-4o", apiKey: "sk-hook", timestamp: new Date().toISOString(), tokens: { prompt_tokens: 30, completion_tokens: 12 } };
    await saveRequestUsage({ ...entry });
    await saveRequestUsage({ ...entry }); // duplicate row → deduped, not counted again
    await saveRequestUsage({ ...entry, timestamp: undefined, tokens: { prompt_tokens: 5, completion_tokens: 0, estimated: true } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await limitsDb.getApiKeyLimitById(created.id)).usedTokens).toBe(42);
    await limitsDb.deleteApiKeyLimit(created.id);
  });
});

describe("api key limit image generation flat charge", () => {
  it("charges 5M per image, ignores provider image tokens, and blocks when under 5M left", async () => {
    const { saveRequestUsage } = await import("../../src/lib/db/repos/usageRepo.js");
    const created = await limitsDb.createApiKeyLimit({
      name: "Image Customer",
      apiKeyId: "key-image",
      apiKey: "sk-image",
      quotaTokens: 12_000_000,
    });
    const path = "/v1/images/generations";
    expect(await limitsDb.apiKeyLimitResponse("sk-image", path)).toBe(null);
    limitsDb.chargeImageGeneration("sk-image");
    limitsDb.chargeImageGeneration("sk-image");
    await saveRequestUsage({ provider: "codex", model: "gpt-image-1", apiKey: "sk-image", endpoint: "/api/v1/images/generations", timestamp: new Date().toISOString(), tokens: { prompt_tokens: 900, completion_tokens: 100 } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await limitsDb.getApiKeyLimitById(created.id)).usedTokens).toBe(10_000_000);
    expect((await limitsDb.apiKeyLimitResponse("sk-image", path)).status).toBe(503); // 2M left < 5M
    expect(await limitsDb.apiKeyLimitResponse("sk-image", "/v1/chat/completions")).toBe(null); // text still allowed
    await limitsDb.deleteApiKeyLimit(created.id);
  });
});

describe("api key limit period reset", () => {
  it("resets usage when a new local day starts", async () => {
    const created = await limitsDb.createApiKeyLimit({
      name: "Period Customer",
      apiKeyId: "key-period",
      apiKey: "sk-period",
      quotaTokens: 1000,
      resetPeriod: "daily",
    });
    await limitsDb.recordApiKeyLimitUsage("sk-period", { prompt_tokens: 50, completion_tokens: 0 });
    expect((await limitsDb.getApiKeyLimitById(created.id)).usedTokens).toBe(50);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect((await limitsDb.authorizeApiKeyLimit("sk-period", tomorrow)).limit.usedTokens).toBe(0);
    await limitsDb.deleteApiKeyLimit(created.id);
  });
});

afterAll(async () => {
  await limitsDb.closeApiKeyLimitDb();
});
