import { NextRequest } from "next/server";
import { POST as chatCompletionsPOST } from "@/app/api/v1/chat/completions/route.js";
import { POST as messagesPOST } from "@/app/api/v1/messages/route.js";
import { POST as responsesPOST } from "@/app/api/v1/responses/route.js";
import { POST as responsesCompactPOST } from "@/app/api/v1/responses/compact/route.js";
import { __test__ as guard } from "@/dashboardGuard.js";
import { apiKeyLimitResponse, chatRoutePath, stripImageTool } from "@/lib/apiKeyLimits/index.js";

// The original upstream route handlers, so their own logic always runs unchanged.
const UPSTREAM_POST = {
  "/api/v1/chat/completions": chatCompletionsPOST,
  "/api/v1/messages": messagesPOST,
  "/api/v1/responses": responsesPOST,
  "/api/v1/responses/compact": responsesCompactPOST,
};

/**
 * POST /api/custom/chat?from=<public chat path> — reached through the proxy
 * rewrite in apiKeyLimitResponse() for quota-limited keys whose request carries
 * the hosted image_generation tool. Drops the tool, then hands the request to
 * the original upstream route handler for that path.
 */
export async function POST(request) {
  const from = new URL(request.url).searchParams.get("from");
  const routePath = chatRoutePath(from);
  const upstreamPOST = UPSTREAM_POST[routePath];
  if (!upstreamPOST) return Response.json({ error: "Invalid chat path" }, { status: 400 });

  // Direct calls skip the public-API proxy branch: re-check API key and limit here.
  if (!(await guard.canAccessPublicLlmApi(request))) {
    return Response.json({ error: "API key required for remote API access" }, { status: 401 });
  }
  const limited = await apiKeyLimitResponse(guard.extractApiKey(request), from);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  stripImageTool(body);

  return upstreamPOST(new NextRequest(new URL(routePath, request.url), {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  }));
}
