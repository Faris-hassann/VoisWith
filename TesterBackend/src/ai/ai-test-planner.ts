import { config } from "../config/env.js";
import { generateDeterministicPlan } from "../testing/deterministic-form-plan.js";
import type { RunContext } from "../testing/run-context.js";
import type { LlmAttempt } from "../errors/error-codes.js";
import { AppError } from "../errors/app-error.js";
import { LLM_FAILURE_REASONS } from "../errors/error-codes.js";
import type { FormSnapshot, FormTestCase } from "../types/llm-contract.js";
import type { PageSnapshot } from "../types/testing.js";
import { delay } from "../utilities/timeout.js";
import { batchFormSnapshots } from "./form-batcher.js";
import { validateFormTestPlan } from "./form-plan-validator.js";
import { OpenRouterClient } from "./openrouter-client.js";
import { PromptLoader } from "./prompt-loader.js";

export interface FormPlanResult {
  testCases: FormTestCase[];
  source: "ai" | "deterministic" | "mixed" | "none";
  batchesPlanned: number;
  batchesFallenBack: number;
}

/**
 * Batches discovered forms (DESIGN-DECISIONS.md §5: 3 forms or ~4k estimated
 * tokens, sequential, one request in flight) and runs each batch through the
 * model chain. A batch that exhausts the chain falls back to the
 * deterministic generator rather than failing the page.
 */
export class AiTestPlanner {
  private readonly client = new OpenRouterClient();
  private readonly prompts = new PromptLoader();

  /**
   * Snapshots are built and deduped by the caller: dedup is run-scoped crawl
   * bookkeeping (§7), and threading that state through the LLM path would put
   * crawl concerns inside the planner.
   */
  async plan(context: RunContext, snapshot: PageSnapshot, snapshots: FormSnapshot[]): Promise<FormPlanResult> {
    const batches = batchFormSnapshots(snapshots);

    const testCases: FormTestCase[] = [];
    let usedAi = false;
    let usedDeterministic = false;
    let batchesFallenBack = 0;
    // Cases are counted, never estimated, as they're accepted below — so a
    // batch is only skipped outright once the cap is already exactly hit.
    const budgetExhausted = () => context.diagnostics.ai.testCasesGenerated >= config.limits.maxAiTestCasesPerRun;

    for (const batch of batches) {
      if (budgetExhausted()) continue;

      const withinCallBudget = context.openRouterCalls < config.limits.maxOpenRouterCallsPerRun;
      let batchCases: FormTestCase[] | undefined;

      if (withinCallBudget) {
        const isFirstCallInRun = context.openRouterCalls === 0;
        context.openRouterCalls += 1;
        if (!isFirstCallInRun && config.openRouter.pacingMs > 0) {
          await delay(config.openRouter.pacingMs);
        }

        try {
          const response = await this.client.createStructuredPlan({
            systemPrompt: await this.prompts.load(),
            context: { formCount: batch.length, forms: batch },
            validate: (value) => {
              const result = validateFormTestPlan(value, batch);
              return result.ok ? { ok: true } : { ok: false, message: JSON.stringify(result.details) };
            },
          });
          // A model that failed before another rescued the call still gets
          // recorded — otherwise a 30s timeout is invisible in the report.
          for (const attempt of response.recoveredAttempts) {
            context.diagnostics.ai.recoveredAttempts.push({ pageUrl: snapshot.url, ...attempt });
          }
          const validated = validateFormTestPlan(response.value, batch);
          if (validated.ok) {
            batchCases = validated.plan.testCases;
            context.diagnostics.ai.successes += 1;
            usedAi = true;
          }
        } catch (error) {
          const reason = error instanceof AppError ? error.llmFailureReason : undefined;
          const attempts = extractLlmAttempts(error);
          const failure = { pageUrl: snapshot.url, message: errorText(error), reason, attempts };
          context.diagnostics.ai.failures.push(failure);
          // A shape failure (this model's response didn't satisfy the contract,
          // as opposed to a transport/rate-limit/availability problem) is worth
          // surfacing distinctly — it is the one category that indicates the
          // model itself misbehaved rather than the network or the account.
          if (reason === LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID) {
            context.diagnostics.ai.validationFailures.push(failure);
          }
        }
      }

      if (!batchCases) {
        batchCases = generateDeterministicPlan(
          batch,
          context.runId,
          context.request.execution.allowFormSubmission,
          new URL(context.targetOrigin).hostname,
        );
        context.diagnostics.ai.deterministicFallbacks += 1;
        batchesFallenBack += 1;
        usedDeterministic = true;
      }

      for (const testCase of batchCases) {
        if (budgetExhausted()) {
          context.diagnostics.ai.testCasesDropped += 1;
          continue;
        }
        testCases.push(testCase);
        context.diagnostics.ai.testCasesGenerated += 1;
      }
    }

    return {
      testCases,
      source: usedAi && usedDeterministic ? "mixed" : usedAi ? "ai" : usedDeterministic ? "deterministic" : "none",
      batchesPlanned: batches.length,
      batchesFallenBack,
    };
  }
}

/** Pulls the full per-model attempt history off an OpenRouterClient exhaustion error, when present. */
function extractLlmAttempts(error: unknown): LlmAttempt[] | undefined {
  if (!(error instanceof AppError)) return undefined;
  const details = error.details;
  if (!details || typeof details !== "object" || !("attempts" in details)) return undefined;
  const attempts = (details as { attempts: unknown }).attempts;
  return Array.isArray(attempts) ? (attempts as LlmAttempt[]) : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
