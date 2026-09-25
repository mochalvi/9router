import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { buildPublicSlug, getLimitState, getPeriodStart, getTokenUsage } from "./core.js";

const DB_FILE = path.join(DATA_DIR, "api-key-limits.sqlite");
const PUBLIC_LOGO_DIRS = [
  path.join(process.cwd(), "public", "providers"),
  path.join(process.cwd(), "..", "public", "providers"),
];
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS apiKeyLimits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    apiKeyId TEXT NOT NULL UNIQUE,
    apiKeyHash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    unlimitedToken INTEGER NOT NULL DEFAULT 0,
    quotaTokens INTEGER NOT NULL DEFAULT 0,
    usedTokens INTEGER NOT NULL DEFAULT 0,
    resetPeriod TEXT NOT NULL DEFAULT 'daily',
    periodStart TEXT,
    expiredAt TEXT,
    providerLogo TEXT,
    showQuota INTEGER NOT NULL DEFAULT 1,
    models TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_api_key_limits_hash ON apiKeyLimits(apiKeyHash);
  CREATE INDEX IF NOT EXISTS idx_api_key_limits_slug ON apiKeyLimits(slug);
`;

if (!global._apiKeyLimitDb) global._apiKeyLimitDb = { instance: null, initPromise: null };
const state = global._apiKeyLimitDb;

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex");
}

function normalizeStatus(value) {
  return value === "disabled" ? "disabled" : "active";
}

function normalizePeriod(value) {
  return ["none", "daily", "weekly", "monthly"].includes(value) ? value : "none";
}

function normalizeProviderLogos(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim());
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function serializeProviderLogos(value) {
  return JSON.stringify(normalizeProviderLogos(value));
}

function normalizeModels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

function serializeModels(value) {
  return JSON.stringify(normalizeModels(value));
}

function parseModels(value) {
  if (!value) return [];
  try {
    return normalizeModels(JSON.parse(value));
  } catch {
    return normalizeModels(value);
  }
}

function parseProviderLogos(value) {
  if (!value) return [];
  try {
    return normalizeProviderLogos(JSON.parse(value));
  } catch {
    return normalizeProviderLogos(value);
  }
}

function normalizeExpiredAt(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("expiredAt must be YYYY-MM-DD");
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid expiredAt");
  return text;
}

function rowToLimit(row, now = new Date()) {
  if (!row) return null;
  const limit = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    apiKeyId: row.apiKeyId,
    status: row.status,
    unlimitedToken: row.unlimitedToken === 1 || row.unlimitedToken === true,
    quotaTokens: Number(row.quotaTokens || 0),
    usedTokens: Number(row.usedTokens || 0),
    resetPeriod: row.resetPeriod || "none",
    periodStart: row.periodStart || "none",
    expiredAt: row.expiredAt || null,
    providerLogos: parseProviderLogos(row.providerLogo),
    providerLogo: parseProviderLogos(row.providerLogo)[0] || null,
    showQuota: row.showQuota !== 0,
    models: parseModels(row.models),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return { ...limit, ...getLimitState(limit, now) };
}

async function createAdapter() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (process.versions.bun) {
    try {
      const { createBunSqliteAdapter } = await import("@/lib/db/adapters/bunSqliteAdapter.js");
      return await createBunSqliteAdapter(DB_FILE);
    } catch {}
  }
  if (!process.versions.bun) {
    const [major] = process.versions.node.split(".").map(Number);
    if (major < 24) {
      try {
        const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
        return createBetterSqliteAdapter(DB_FILE);
      } catch {}
    }
    try {
      const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
      return await createNodeSqliteAdapter(DB_FILE);
    } catch {}
  }
  const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
  return createSqlJsAdapter(DB_FILE);
}

function ensureSchema(db) {
  db.exec(SCHEMA_SQL);
  const columns = new Set(db.all("PRAGMA table_info(apiKeyLimits)").map((column) => column.name));
  if (!columns.has("showQuota")) db.exec("ALTER TABLE apiKeyLimits ADD COLUMN showQuota INTEGER NOT NULL DEFAULT 1");
  if (!columns.has("models")) db.exec("ALTER TABLE apiKeyLimits ADD COLUMN models TEXT NOT NULL DEFAULT '[]'");
}

async function getDb() {
  if (state.instance) {
    ensureSchema(state.instance);
    return state.instance;
  }
  if (!state.initPromise) {
    state.initPromise = createAdapter().then((db) => {
      ensureSchema(db);
      state.instance = db;
      return db;
    });
  }
  return state.initPromise;
}

function validateInput(input, partial = false) {
  const source = input || {};
  if (!partial || source.name !== undefined) {
    if (typeof source.name !== "string" || !source.name.trim()) throw new Error("Name is required");
  }
  if (!partial || source.apiKeyId !== undefined) {
    if (typeof source.apiKeyId !== "string" || !source.apiKeyId.trim()) throw new Error("API Key is required");
  }
  if (!partial || source.apiKey !== undefined) {
    if (typeof source.apiKey !== "string" || !source.apiKey.trim()) throw new Error("API Key value is required");
  }
  if (source.status !== undefined && !["active", "disabled"].includes(source.status)) throw new Error("Invalid status");
  if (source.resetPeriod !== undefined && !["none", "daily", "weekly", "monthly"].includes(source.resetPeriod)) throw new Error("Invalid reset period");
  if (source.unlimitedToken === false || source.unlimitedToken === undefined && source.quotaTokens !== undefined) {
    const quota = Number(source.quotaTokens);
    if (!Number.isSafeInteger(quota) || quota <= 0) throw new Error("Quota Token must be a positive integer");
  }
  if (source.expiredAt) normalizeExpiredAt(source.expiredAt);
  const providerLogos = normalizeProviderLogos(source.providerLogos ?? source.providerLogo);
  if (providerLogos.some((logo) => !getProviderLogoIds().includes(logo))) throw new Error("Invalid provider logo");
  if (source.showQuota !== undefined && typeof source.showQuota !== "boolean") throw new Error("Invalid quota visibility");
  if (source.models !== undefined && (!Array.isArray(source.models) || source.models.some((model) => typeof model !== "string" || !model.trim()))) throw new Error("Invalid models");
}

function nextUniqueSlug(db, name, currentId = null) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = buildPublicSlug(name);
    const existing = db.get("SELECT id FROM apiKeyLimits WHERE slug = ?", [slug]);
    if (!existing || existing.id === currentId) return slug;
  }
  throw new Error("Unable to generate unique public URL");
}

function resetRowIfNeeded(db, row, now = new Date()) {
  const periodStart = getPeriodStart(row.resetPeriod, now) || "none";
  if (row.periodStart === periodStart) return row;
  db.run("UPDATE apiKeyLimits SET usedTokens = 0, periodStart = ?, updatedAt = ? WHERE id = ?", [periodStart, now.toISOString(), row.id]);
  return { ...row, usedTokens: 0, periodStart };
}

function checkRow(row, now = new Date()) {
  return getLimitState(rowToLimit(row, now), now);
}

export async function listApiKeyLimits() {
  const db = await getDb();
  const rows = db.all("SELECT * FROM apiKeyLimits ORDER BY createdAt DESC");
  return rows.map((row) => rowToLimit(resetRowIfNeeded(db, row)));
}

export async function getApiKeyLimitById(id) {
  const db = await getDb();
  const row = db.get("SELECT * FROM apiKeyLimits WHERE id = ?", [id]);
  return rowToLimit(row ? resetRowIfNeeded(db, row) : row);
}

export async function getApiKeyLimitBySlug(slug) {
  const db = await getDb();
  const row = db.get("SELECT * FROM apiKeyLimits WHERE slug = ?", [slug]);
  return rowToLimit(row ? resetRowIfNeeded(db, row) : row);
}

export async function createApiKeyLimit({ name, apiKeyId, apiKey, status = "active", unlimitedToken = false, quotaTokens = 0, resetPeriod = "none", expiredAt = null, providerLogos = [], providerLogo = null, models = [], showQuota = true }) {
  validateInput({ name, apiKeyId, apiKey, status, unlimitedToken, quotaTokens, resetPeriod, expiredAt, providerLogos, providerLogo, models, showQuota });
  const db = await getDb();
  const now = new Date();
  const id = crypto.randomUUID();
  const slug = nextUniqueSlug(db, name);
  const period = normalizePeriod(resetPeriod);
  const periodStart = getPeriodStart(period, now) || "none";
  db.run(
    `INSERT INTO apiKeyLimits(id, name, slug, apiKeyId, apiKeyHash, status, unlimitedToken, quotaTokens, usedTokens, resetPeriod, periodStart, expiredAt, providerLogo, showQuota, models, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name.trim(), slug, apiKeyId, hashApiKey(apiKey), normalizeStatus(status), unlimitedToken ? 1 : 0, unlimitedToken ? 0 : Number(quotaTokens), period, periodStart, normalizeExpiredAt(expiredAt), serializeProviderLogos(providerLogos.length ? providerLogos : providerLogo), showQuota ? 1 : 0, serializeModels(models), now.toISOString(), now.toISOString()]
  );
  return getApiKeyLimitById(id);
}

export async function updateApiKeyLimit(id, input) {
  validateInput(input, true);
  const db = await getDb();
  const current = db.get("SELECT * FROM apiKeyLimits WHERE id = ?", [id]);
  if (!current) return null;
  const next = {
    name: input.name === undefined ? current.name : input.name.trim(),
    apiKeyId: input.apiKeyId === undefined ? current.apiKeyId : input.apiKeyId,
    apiKeyHash: input.apiKey ? hashApiKey(input.apiKey) : current.apiKeyHash,
    status: input.status === undefined ? current.status : normalizeStatus(input.status),
    unlimitedToken: input.unlimitedToken === undefined ? current.unlimitedToken : input.unlimitedToken ? 1 : 0,
    quotaTokens: input.quotaTokens === undefined ? current.quotaTokens : Number(input.quotaTokens),
    resetPeriod: input.resetPeriod === undefined ? current.resetPeriod || "none" : normalizePeriod(input.resetPeriod),
    expiredAt: input.expiredAt === undefined ? current.expiredAt : normalizeExpiredAt(input.expiredAt),
    providerLogos: input.providerLogos === undefined && input.providerLogo === undefined ? parseProviderLogos(current.providerLogo) : normalizeProviderLogos(input.providerLogos ?? input.providerLogo),
    models: input.models === undefined ? parseModels(current.models) : normalizeModels(input.models),
    showQuota: input.showQuota === undefined ? current.showQuota !== false : input.showQuota,
  };
  if (!next.unlimitedToken && (!Number.isSafeInteger(next.quotaTokens) || next.quotaTokens <= 0)) throw new Error("Quota Token must be a positive integer");
  const now = new Date();
  const periodStart = next.resetPeriod === current.resetPeriod ? (current.periodStart || "none") : (getPeriodStart(next.resetPeriod, now) || "none");
  db.run(
    `UPDATE apiKeyLimits SET name = ?, apiKeyId = ?, apiKeyHash = ?, status = ?, unlimitedToken = ?, quotaTokens = ?, resetPeriod = ?, periodStart = ?, expiredAt = ?, providerLogo = ?, showQuota = ?, models = ?, updatedAt = ? WHERE id = ?`,
    [next.name, next.apiKeyId, next.apiKeyHash, next.status, next.unlimitedToken, next.unlimitedToken ? 0 : next.quotaTokens, next.resetPeriod, periodStart, next.expiredAt, serializeProviderLogos(next.providerLogos), next.showQuota ? 1 : 0, serializeModels(next.models), now.toISOString(), id]
  );
  return getApiKeyLimitById(id);
}

export async function resetApiKeyLimitQuota(id, now = new Date()) {
  const db = await getDb();
  let reset = false;
  db.transaction(() => {
    const row = db.get("SELECT id, resetPeriod FROM apiKeyLimits WHERE id = ?", [id]);
    if (!row) return;
    const periodStart = getPeriodStart(row.resetPeriod, now) || "none";
    const result = db.run(
      "UPDATE apiKeyLimits SET usedTokens = 0, periodStart = ?, updatedAt = ? WHERE id = ?",
      [periodStart, now.toISOString(), id]
    );
    reset = (result?.changes || 0) > 0;
  });
  return reset ? getApiKeyLimitById(id) : null;
}

export async function deleteApiKeyLimit(id) {
  const db = await getDb();
  return (db.run("DELETE FROM apiKeyLimits WHERE id = ?", [id])?.changes || 0) > 0;
}

export async function authorizeApiKeyLimit(apiKey, modelOrNow = null, maybeNow = new Date()) {
  if (!apiKey) return { hasLimit: false, allowed: true };
  const model = modelOrNow instanceof Date ? null : modelOrNow;
  const now = modelOrNow instanceof Date ? modelOrNow : maybeNow;
  const db = await getDb();
  let result = { hasLimit: false, allowed: true };
  db.transaction(() => {
    let row = db.get("SELECT * FROM apiKeyLimits WHERE apiKeyHash = ?", [hashApiKey(apiKey)]);
    if (!row) return;
    result.hasLimit = true;
    row = resetRowIfNeeded(db, row, now);
    const state = checkRow(row, now);
    const limit = rowToLimit(row, now);
    const modelAllowed = isApiKeyLimitModelAllowed(limit, model);
    result = {
      hasLimit: true,
      allowed: state.allowed && modelAllowed,
      reason: !modelAllowed ? "model" : state.isExpired ? "expired" : row.status !== "active" ? "disabled" : "exhausted",
      limit,
    };
  });
  return result;
}

export function isApiKeyLimitModelAllowed(limit, model) {
  const allowedModels = normalizeModels(limit?.models);
  return !model || allowedModels.length === 0 || allowedModels.includes(String(model));
}

export async function recordApiKeyLimitUsage(apiKey, usage, now = new Date()) {
  const tokens = getTokenUsage(usage);
  if (!apiKey || !tokens || usage?.estimated === true) return { hasLimit: false, allowed: true, recorded: false, tokens: 0 };
  const db = await getDb();
  let result = { hasLimit: false, allowed: true, recorded: false, tokens };
  db.transaction(() => {
    let row = db.get("SELECT * FROM apiKeyLimits WHERE apiKeyHash = ?", [hashApiKey(apiKey)]);
    if (!row) return;
    result.hasLimit = true;
    row = resetRowIfNeeded(db, row, now);
    const state = checkRow(row, now);
    if (!state.allowed) {
      result.allowed = false;
      return;
    }
    const changed = db.run(
      `UPDATE apiKeyLimits SET usedTokens = usedTokens + ?, updatedAt = ?
       WHERE id = ? AND status = 'active' AND (expiredAt IS NULL OR expiredAt >= ?)
       AND (unlimitedToken = 1 OR usedTokens < quotaTokens)`,
      [tokens, now.toISOString(), row.id, now.toISOString().slice(0, 10)]
    );
    result.recorded = (changed?.changes || 0) > 0;
  });
  return result;
}

export function getApiKeyLimitPublicData(limit) {
  if (!limit) return null;
  return {
    name: limit.name,
    slug: limit.slug,
    status: limit.status,
    unlimitedToken: limit.unlimitedToken,
    quotaTokens: limit.quotaTokens,
    usedTokens: limit.usedTokens,
    remainingTokens: limit.remainingTokens,
    percentage: limit.percentage,
    resetPeriod: limit.resetPeriod,
    resetCountdown: limit.resetCountdown,
    expiredAt: limit.expiredAt,
    formattedExpiredAt: limit.formattedExpiredAt,
    providerLogos: limit.providerLogos,
    providerLogo: limit.providerLogo,
    models: normalizeModels(limit.models),
    showQuota: limit.showQuota,
    allowed: limit.allowed,
    isExpired: limit.isExpired,
  };
}

export function getProviderLogoIds() {
  for (const directory of PUBLIC_LOGO_DIRS) {
    try {
      return fs.readdirSync(directory).filter((file) => file.toLowerCase().endsWith(".png")).map((file) => file.slice(0, -4)).sort();
    } catch {}
  }
  return [];
}

export async function closeApiKeyLimitDb() {
  if (state.instance?.close) state.instance.close();
  state.instance = null;
  state.initPromise = null;
}

export { DB_FILE };
