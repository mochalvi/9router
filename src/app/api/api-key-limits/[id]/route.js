import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb.js";
import { deleteApiKeyLimit, getApiKeyLimitById, resetApiKeyLimitQuota, updateApiKeyLimit } from "@/lib/apiKeyLimits/index.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const limit = await getApiKeyLimitById(id);
  if (!limit) return NextResponse.json({ error: "Limit not found" }, { status: 404 });
  return NextResponse.json({ limit });
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.apiKey && !body.apiKeyId) {
      return NextResponse.json({ error: "Use apiKeyId to change API Key" }, { status: 400 });
    }
    if (body.apiKeyId) {
      const apiKey = await getApiKeyById(body.apiKeyId);
      if (!apiKey || !apiKey.isActive) return NextResponse.json({ error: "Active API Key is required" }, { status: 400 });
      body.apiKey = apiKey.key;
    }
    const limit = await updateApiKeyLimit(id, body);
    if (!limit) return NextResponse.json({ error: "Limit not found" }, { status: 404 });
    return NextResponse.json({ limit });
  } catch (error) {
    const status = /required|invalid|quota|expired|positive/i.test(error.message || "") ? 400 : 500;
    return NextResponse.json({ error: error.message || "Failed to update API key limit" }, { status });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.action !== "reset-quota") return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    const limit = await resetApiKeyLimitQuota(id);
    if (!limit) return NextResponse.json({ error: "Limit not found" }, { status: 404 });
    return NextResponse.json({ limit });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to reset quota" }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const deleted = await deleteApiKeyLimit(id);
  if (!deleted) return NextResponse.json({ error: "Limit not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
