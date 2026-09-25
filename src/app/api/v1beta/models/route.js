import { PROVIDER_MODELS } from "@/shared/constants/models";
import { extractApiKey } from "@/sse/services/auth.js";
import { authorizeApiKeyLimit } from "@/lib/apiKeyLimits/index.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    const apiKey = extractApiKey(request) || new URL(request.url).searchParams.get("key");
    const apiKeyLimit = await authorizeApiKeyLimit(apiKey);
    const allowedModels = Array.isArray(apiKeyLimit.limit?.models) && apiKeyLimit.limit.models.length > 0
      ? new Set(apiKeyLimit.limit.models)
      : null;
    const models = [];
    const seen = new Set();

    function addModel({ name, displayName, description, methods = ["generateContent"] }) {
      const modelId = name.replace(/^models\//, "");
      if (allowedModels && !allowedModels.has(modelId) && !allowedModels.has(`gemini/${modelId}`)) return;
      if (seen.has(name)) return;
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: model.name || model.id,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
          });
        }
      }
    }

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
