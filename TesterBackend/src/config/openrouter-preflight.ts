import { config } from "./env.js";
import { logger } from "./logger.js";

/**
 * Confirms the three pinned model slugs are still listed by OpenRouter before
 * the server starts accepting runs. The free-model catalogue rotates —
 * offline format validation (env.ts) catches typos, but only a live check
 * catches a model that was delisted since `.env` was last updated.
 *
 * Skipped when AI is not configured at all (nothing to validate) or under
 * `NODE_ENV=test` (unit tests must not depend on network access). An
 * unreachable OpenRouter otherwise blocks boot — accepted trade-off so a
 * misconfigured or dead model chain is never discovered mid-run instead.
 *
 * See DESIGN-DECISIONS.md §5.
 */
export async function preflightOpenRouterModels(): Promise<void> {
  if (!config.openRouter.apiKey || config.nodeEnv === "test") return;

  const response = await fetch(`${config.openRouter.baseUrl}/models`);
  if (!response.ok) {
    throw new Error(`Could not reach OpenRouter to verify pinned models (${response.status}). Refusing to start.`);
  }

  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  const available = new Set((body.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id)));
  const freeCount = [...available].filter((id) => id.endsWith(":free")).length;

  const unlisted = config.openRouter.models.filter((model) => !available.has(model));
  if (unlisted.length > 0) {
    throw new Error(
      `OPENROUTER_MODELS contains model(s) no longer listed by OpenRouter: ${unlisted.join(", ")}. ` +
        `${freeCount} free model(s) are currently available. Run "npm run openrouter:models" to see current options and update .env.`,
    );
  }

  logger.info({ models: config.openRouter.models }, "OpenRouter model preflight passed");
}
