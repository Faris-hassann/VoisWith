import "dotenv/config";

// The OpenRouter free-tier catalogue rotates — do not hardcode model ids from
// memory or from an old chat transcript. This script prints what is actually
// listed right now, to paste into OPENROUTER_MODELS. See DESIGN-DECISIONS.md §5.

const baseUrl = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");

const response = await fetch(`${baseUrl}/models`);
if (!response.ok) {
  throw new Error(`Could not fetch ${baseUrl}/models (${response.status}).`);
}

const body = await response.json();
const freeModels = (body.data ?? [])
  .filter((model) => typeof model.id === "string" && model.id.endsWith(":free"))
  .sort((a, b) => a.id.localeCompare(b.id));

if (freeModels.length === 0) {
  console.log("No :free models are currently listed by OpenRouter.");
  process.exit(0);
}

console.log(`${freeModels.length} free model(s) currently available:\n`);
for (const model of freeModels) {
  const context = model.context_length ? ` (context: ${model.context_length})` : "";
  console.log(`  ${model.id}${context}`);
}

console.log("\nPin exactly 3 in .env, e.g.:");
console.log(`OPENROUTER_MODELS=${freeModels.slice(0, 3).map((model) => model.id).join(",")}`);
