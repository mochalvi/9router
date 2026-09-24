import crypto from "node:crypto";

const RANDOM_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (byte) => RANDOM_CHARS[byte % RANDOM_CHARS.length]).join("");
}

export function slugifyLimitName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "limit";
}

export function buildPublicSlug(name, suffixFactory = randomSuffix) {
  return `${slugifyLimitName(name)}-${suffixFactory()}`;
}

export function getTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const baseInput = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
  const input = baseInput + (Number.isFinite(cacheRead) ? cacheRead : 0) + (Number.isFinite(cacheCreation) ? cacheCreation : 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return 0;
  return input > 0 || output > 0
    ? Math.max(0, Math.floor(input)) + Math.max(0, Math.floor(output))
    : 0;
}

export function getPeriodStart(resetPeriod, date = new Date()) {
  if (!resetPeriod || resetPeriod === "none") return null;
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  if (resetPeriod === "weekly") {
    const daysFromMonday = (value.getUTCDay() + 6) % 7;
    value.setUTCDate(value.getUTCDate() - daysFromMonday);
  } else if (resetPeriod === "monthly") {
    value.setUTCDate(1);
  }
  return value.toISOString();
}

export function getNextResetAt(resetPeriod, date = new Date()) {
  if (!resetPeriod || resetPeriod === "none") return null;
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  if (resetPeriod === "daily") value.setUTCDate(value.getUTCDate() + 1);
  if (resetPeriod === "weekly") {
    const daysUntilMonday = 7 - ((value.getUTCDay() + 6) % 7);
    value.setUTCDate(value.getUTCDate() + daysUntilMonday);
  }
  if (resetPeriod === "monthly") {
    value.setUTCMonth(value.getUTCMonth() + 1, 1);
  }
  return value;
}

export function getResetCountdown(resetPeriod, now = new Date(), expiredAt = null) {
  const nextResetAt = getNextResetAt(resetPeriod, now);
  if (!nextResetAt) return null;
  const expiry = expiryTime(expiredAt);
  if (expiry !== null && nextResetAt.getTime() > expiry) return null;
  const totalHours = Math.max(0, Math.floor((nextResetAt.getTime() - new Date(now).getTime()) / 3600000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0 && hours > 0) return `${days} Hari ${hours} jam`;
  if (days > 0) return `${days} Hari`;
  if (hours > 0) return `${hours} jam`;
  return "kurang dari 1 jam";
}

export function formatExpiredDate(expiredAt) {
  if (!expiredAt) return null;
  const parsed = new Date(`${expiredAt}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${parsed.getUTCDate()} ${months[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

function expiryTime(expiredAt) {
  if (!expiredAt) return null;
  const value = String(expiredAt);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function getLimitState(limit, now = new Date()) {
  const expired = expiryTime(limit?.expiredAt);
  const isExpired = expired !== null && new Date(now).getTime() > expired;
  const unlimited = limit?.unlimitedToken === true;
  const quota = Number(limit?.quotaTokens || 0);
  const used = Math.max(0, Number(limit?.usedTokens || 0));
  const remainingTokens = unlimited ? null : Math.max(0, quota - used);
  const allowed = limit?.status === "active" && !isExpired && (unlimited || remainingTokens > 0);
  const percentage = unlimited ? 100 : quota > 0 ? Math.max(0, Math.min(100, (remainingTokens / quota) * 100)) : 0;
  return {
    allowed,
    isExpired,
    remainingTokens,
    percentage,
    usedTokens: used,
    quotaTokens: unlimited ? null : quota,
    resetCountdown: getResetCountdown(limit?.resetPeriod, now, limit?.expiredAt),
    formattedExpiredAt: formatExpiredDate(limit?.expiredAt),
  };
}
