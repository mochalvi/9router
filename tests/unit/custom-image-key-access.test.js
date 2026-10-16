// custom: image generation is exempt from per-key access restriction (see CUSTOM.md).
// A restricted key must reach the credential lookup for any image model.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ getProviderCredentials: vi.fn() }));
const keys = {
  "sk-empty": { id: "e", name: "empty", isActive: true, access: { restricted: true, allow: [] } },
};

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback" }),
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (k) => keys[k] || null }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: (request) => request.headers.get("Authorization")?.slice(7) || null,
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderCredentials.mockResolvedValue(null);
});

describe("image generation (custom: exempt from key access)", () => {
  it("lets a restricted key with an empty allow list call any image model", async () => {
    const res = await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-empty" },
      body: JSON.stringify({ model: "openai/gpt-image-1", prompt: "x" }),
    }));
    expect(res.status).not.toBe(403);
    expect(mocks.getProviderCredentials).toHaveBeenCalled();
  });
});
