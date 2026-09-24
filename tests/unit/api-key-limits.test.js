import { afterAll, describe, expect, it } from "vitest";
import {
  buildPublicSlug,
  getPeriodStart,
  getTokenUsage,
  getLimitState,
  getResetCountdown,
  formatExpiredDate,
} from "../../src/lib/apiKeyLimits/core.js";

process.env.DATA_DIR = `${process.env.TEMP || process.env.TMP || "."}/9router-api-key-limit-tests`;
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

  it("calculates reset periods, countdown, and Indonesian expiry date", () => {
    const date = new Date("2026-09-24T16:30:00.000Z");
    expect(getPeriodStart("none", date)).toBe(null);
    expect(getPeriodStart("daily", date)).toBe("2026-09-24T00:00:00.000Z");
    expect(getPeriodStart("weekly", date)).toBe("2026-09-21T00:00:00.000Z");
    expect(getPeriodStart("monthly", date)).toBe("2026-09-01T00:00:00.000Z");
    expect(getResetCountdown("daily", date)).toBe("7 jam");
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
    const reset = await limitsDb.resetApiKeyLimitQuota(created.id);
    expect(reset.usedTokens).toBe(0);
    expect((await limitsDb.authorizeApiKeyLimit("sk-smoke")).allowed).toBe(true);
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
    expect((await limitsDb.authorizeApiKeyLimit("sk-expired", new Date("2026-09-24T00:00:00Z"))).allowed).toBe(false);
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

afterAll(async () => {
  await limitsDb.closeApiKeyLimitDb();
});
