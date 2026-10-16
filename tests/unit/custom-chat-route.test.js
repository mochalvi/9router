import { describe, expect, it, vi } from "vitest";

const calls = [];
const fakePost = (name) => async (request) => {
  calls.push({ name, url: request.url, body: await request.json() });
  return new Response("ok");
};
vi.mock("@/app/api/v1/chat/completions/route.js", () => ({ POST: fakePost("chat") }));
vi.mock("@/app/api/v1/messages/route.js", () => ({ POST: fakePost("messages") }));
vi.mock("@/app/api/v1/responses/route.js", () => ({ POST: fakePost("responses") }));
vi.mock("@/app/api/v1/responses/compact/route.js", () => ({ POST: fakePost("compact") }));
vi.mock("@/dashboardGuard.js", () => ({
  __test__: {
    canAccessPublicLlmApi: async (request) => request.headers.get("authorization") === "Bearer sk-ok",
    extractApiKey: () => "sk-ok",
  },
}));
vi.mock("@/lib/apiKeyLimits/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  apiKeyLimitResponse: async () => null,
}));

const { POST } = await import("../../src/app/api/custom/chat/route.js");
const post = (from, auth = "Bearer sk-ok") => new Request(`http://localhost/api/custom/chat?from=${encodeURIComponent(from)}`, {
  method: "POST",
  headers: { authorization: auth, "content-type": "application/json" },
  body: JSON.stringify({ model: "cx/gpt-6-sol", input: "hi", tools: [{ type: "function", name: "shell" }, { type: "image_generation" }] }),
});

describe("custom image-tool strip route", () => {
  it("hands the stripped request to the original upstream route handler", async () => {
    expect((await POST(post("/codex/responses"))).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ name: "responses", url: "http://localhost/api/v1/responses" });
    expect(calls.at(-1).body.tools).toEqual([{ type: "function", name: "shell" }]);

    await POST(post("/v1/responses/compact"));
    expect(calls.at(-1).name).toBe("compact");
  });

  it("rejects unknown paths and missing API keys", async () => {
    expect((await POST(post("/api/keys"))).status).toBe(400);
    expect((await POST(post("/v1/responses", "Bearer bad"))).status).toBe(401);
  });
});
