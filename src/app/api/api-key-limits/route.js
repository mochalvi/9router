import { NextResponse } from "next/server";
import { getApiKeyById, getApiKeys } from "@/lib/localDb.js";
import {
  createApiKeyLimit,
  getProviderLogoIds,
  listApiKeyLimits,
} from "@/lib/apiKeyLimits/index.js";

export const dynamic = "force-dynamic";

function maskKey(key) {
  if (!key || key.length < 10) return "••••••••";
  return `${key.slice(0, 5)}••••${key.slice(-4)}`;
}

export async function GET() {
  try {
    const [limits, keys] = await Promise.all([listApiKeyLimits(), getApiKeys()]);
    return NextResponse.json({
      limits,
      apiKeys: keys.map((key) => ({ id: key.id, name: key.name, key: maskKey(key.key), isActive: key.isActive })),
      providerLogos: getProviderLogoIds(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to load API key limits" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const apiKey = await getApiKeyById(body.apiKeyId);
    if (!apiKey || !apiKey.isActive) return NextResponse.json({ error: "Active API Key is required" }, { status: 400 });
    const limit = await createApiKeyLimit({ ...body, apiKey: apiKey.key });
    return NextResponse.json({ limit }, { status: 201 });
  } catch (error) {
    const status = /required|invalid|quota|expired|positive/i.test(error.message || "") ? 400 : 500;
    return NextResponse.json({ error: error.message || "Failed to create API key limit" }, { status });
  }
}
