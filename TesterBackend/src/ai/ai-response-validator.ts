import { aiTestPlanSchema } from "../schemas/ai-test-plan.schema.js";
import { TEST_TYPES } from "../testing/test-types.js";
import { ACTION_TYPES, type TestPlan } from "../types/ai.js";
import type { ElementInventoryItem } from "../types/testing.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";

export class AiResponseValidator {
  validate(raw: unknown, elements: ElementInventoryItem[]): TestPlan {
    const normalized = normalizePlan(raw);
    const parsed = aiTestPlanSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODES.INVALID_AI_RESPONSE,
        message: "OpenRouter returned an invalid test plan.",
        statusCode: 502,
        details: parsed.error.flatten(),
      });
    }

    const elementIds = new Set(elements.map((element) => element.id));
    for (const testCase of parsed.data.testCases) {
      for (const action of [...testCase.steps, ...testCase.assertions, ...testCase.cleanupActions]) {
        if (action.elementId && !elementIds.has(action.elementId)) {
          throw new AppError({
            code: ERROR_CODES.INVALID_AI_RESPONSE,
            message: "AI test plan referenced an unknown element ID.",
            statusCode: 502,
            details: { action },
          });
        }
      }
    }

    return parsed.data;
  }
}

function normalizePlan(raw: unknown): unknown {
  const source = unwrapPlan(raw);
  if (!isRecord(source)) return raw;

  return {
    pageSummary: stringValue(source.pageSummary) ?? stringValue(source.summary) ?? "AI generated page summary unavailable.",
    identifiedPurpose: stringValue(source.identifiedPurpose) ?? stringValue(source.purpose) ?? "Unknown page purpose.",
    risks: stringArray(source.risks).slice(0, 30),
    testCases: arrayValue(source.testCases ?? source.tests ?? source.test_cases).map(normalizeTestCase).filter(Boolean),
    additionalLinksToPrioritize: stringArray(source.additionalLinksToPrioritize ?? source.additionalLinks ?? source.links)
      .filter((url) => isAbsoluteUrl(url))
      .slice(0, 50),
    pageTestingComplete: typeof source.pageTestingComplete === "boolean" ? source.pageTestingComplete : true,
  };
}

function normalizeTestCase(value: unknown, index: number): unknown {
  if (!isRecord(value)) return undefined;
  const type = enumValue(stringValue(value.type), TEST_TYPES) ?? "SMOKE";
  const priority = enumValue(stringValue(value.priority), ["HIGH", "MEDIUM", "LOW"] as const) ?? "MEDIUM";
  return {
    id: stringValue(value.id)?.slice(0, 100) ?? `ai_test_${index + 1}`,
    name: stringValue(value.name)?.slice(0, 200) ?? `AI generated test ${index + 1}`,
    type,
    priority,
    preconditions: stringArray(value.preconditions).slice(0, 20),
    steps: arrayValue(value.steps).map(normalizeAction).filter(Boolean),
    assertions: arrayValue(value.assertions).map(normalizeAction).filter(Boolean),
    cleanupActions: arrayValue(value.cleanupActions ?? value.cleanup).map(normalizeAction).filter(Boolean),
    destructive: typeof value.destructive === "boolean" ? value.destructive : false,
    reasoningSummary: stringValue(value.reasoningSummary ?? value.reasoning)?.slice(0, 1000) ?? "AI generated safe test case.",
  };
}

function normalizeAction(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const action = enumValue(stringValue(value.action ?? value.type), ACTION_TYPES);
  if (!action) return undefined;
  const normalized: Record<string, unknown> = {
    action,
    description: stringValue(value.description)?.slice(0, 500),
  };
  const elementId = stringValue(value.elementId ?? value.element_id);
  if (elementId && /^element_\d+$/.test(elementId)) normalized.elementId = elementId;
  if (requiresElement(action) && !normalized.elementId) return undefined;
  const url = stringValue(value.url);
  if (url && isAbsoluteUrl(url)) normalized.url = url;
  if (action === "NAVIGATE" && !normalized.url) return undefined;
  const expectedUrl = stringValue(value.expectedUrl);
  if (expectedUrl && isAbsoluteUrl(expectedUrl)) normalized.expectedUrl = expectedUrl;
  const valueText = stringValue(value.value);
  if (valueText) normalized.value = valueText.slice(0, 2000);
  const valueStrategy = stringValue(value.valueStrategy ?? value.value_strategy);
  if (valueStrategy) normalized.valueStrategy = valueStrategy.slice(0, 100);
  const expectedText = stringValue(value.expectedText ?? value.expected_text);
  if (expectedText) normalized.expectedText = expectedText.slice(0, 2000);
  const key = stringValue(value.key);
  if (key) normalized.key = key.slice(0, 50);
  if (typeof value.timeoutMs === "number") normalized.timeoutMs = Math.max(0, Math.min(60000, Math.trunc(value.timeoutMs)));
  return normalized;
}

function unwrapPlan(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  return raw.testPlan ?? raw.plan ?? raw.result ?? raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map(stringValue).filter((item): item is string => Boolean(item));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function enumValue<T extends readonly string[]>(value: string | undefined, allowed: T): T[number] | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase().replace(/[\s-]+/g, "_");
  return allowed.find((item) => item === normalized) as T[number] | undefined;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function requiresElement(action: string): boolean {
  return !new Set(["NAVIGATE", "ASSERT_URL", "RELOAD", "GO_BACK", "STOP"]).has(action);
}
