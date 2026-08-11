import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(backendRoot, ".env"), override: false });

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing.");

const apiUrl = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const prompt = await fs.readFile(path.join(backendRoot, process.env.PROMPT_FILE_PATH ?? "src/prompts/form-test-planner.system.md"), "utf8");
const response = await fetch(apiUrl, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `INPUT_JSON\n${JSON.stringify({
        formCount: 1,
        forms: [{ formId: "smoke_form", elementId: "element_1", fields: [{ elementId: "element_2", kind: "input", type: "email", label: "Email", required: true, disabled: false }], submitLabel: "Submit" }],
      })}` },
    ],
    response_format: { type: "json_object" },
    stream: false,
  }),
});
const body = await response.text();
if (!response.ok) throw new Error(`OpenRouter smoke request failed (${response.status}): ${body.slice(0, 300)}`);
const envelope = JSON.parse(body);
const content = envelope?.choices?.[0]?.message?.content;
const plan = typeof content === "string" ? JSON.parse(content) : content;
if (!Array.isArray(plan?.testCases)) throw new Error("OpenRouter smoke response did not contain testCases.");
console.log(JSON.stringify({ ok: true, model, testCases: plan.testCases.length }, null, 2));
