import { aiTestPlanSchema } from "../schemas/ai-test-plan.schema.js";
import type { TestPlan } from "../types/ai.js";
import type { ElementInventoryItem } from "../types/testing.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";

export class AiResponseValidator {
  validate(raw: unknown, elements: ElementInventoryItem[]): TestPlan {
    const parsed = aiTestPlanSchema.safeParse(raw);
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
