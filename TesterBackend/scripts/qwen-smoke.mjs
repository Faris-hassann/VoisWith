import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
loadDotenv({ path: path.join(backendRoot, ".env"), override: false });

async function main() {
  const apiKey = process.env.QWEN_API_KEY;
  const apiUrl = (process.env.QWEN_API_URL ?? "https://qwen.snouhy.com/chat").replace(/\/$/, "");
  const timeoutMs = Number(process.env.QWEN_TIMEOUT_MS ?? "60000");
  const promptPath = path.resolve(backendRoot, process.env.PROMPT_FILE_PATH ?? "src/prompts/form-test-planner.system.md");

  if (!apiKey) {
    throw new Error("QWEN_API_KEY is missing.");
  }

  const prompt = await fs.readFile(promptPath, "utf8");
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(new Error("Qwen smoke request timed out.")), timeoutMs);

  try {
    const message = `${prompt}\nINPUT_JSON\n${JSON.stringify({
      formCount: 1,
      forms: [
        {
          formId: "fixture-form",
          elementId: "element_1",
          routeFamily: "/contact",
          apparentPurpose: "Contact form",
          fields: [
            {
              elementId: "element_2",
              kind: "input",
              type: "text",
              name: "name",
              label: "Name",
              required: true,
              disabled: false,
            },
            {
              elementId: "element_3",
              kind: "input",
              type: "email",
              name: "email",
              label: "Email",
              required: true,
              disabled: false,
            },
          ],
          submitLabel: "Send",
        },
      ],
    })}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const bodyText = await response.text();
    let parsedBody;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = null;
    }

    const result = {
      status: response.status,
      ok: response.ok,
      contentType,
      promptLoaded: prompt.length > 0,
      hasStructuredTestCases: Boolean(extractStructuredValue(parsedBody)),
    };
    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      throw new Error(`Qwen smoke request failed with HTTP ${result.status}.`);
    }
    if (!result.hasStructuredTestCases) {
      throw new Error("Qwen smoke response did not contain a valid testCases payload.");
    }
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function extractStructuredValue(input) {
  if (!input || typeof input !== "object") return null;
  if (Array.isArray(input.testCases)) return input;
  for (const value of Object.values(input)) {
    if (typeof value === "string") {
      try {
        const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
        const objectStart = value.indexOf("{");
        const objectEnd = value.lastIndexOf("}");
        const jsonText = fenced ?? (objectStart >= 0 && objectEnd > objectStart ? value.slice(objectStart, objectEnd + 1) : value);
        const parsed = JSON.parse(jsonText);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.testCases)) return parsed;
      } catch {
        continue;
      }
    }
    if (value && typeof value === "object") {
      const nested = extractStructuredValue(value);
      if (nested) return nested;
    }
  }
  return null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
