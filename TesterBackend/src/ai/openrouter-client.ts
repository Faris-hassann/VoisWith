import { config } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { redactSecrets } from "../security/secret-redaction.js";
import { withTimeout } from "../utilities/timeout.js";

export class OpenRouterClient {
  async createStructuredPlan(input: { systemPrompt: string; context: unknown }): Promise<unknown> {
    if (!config.openRouter.apiKey || !config.openRouter.model) {
      throw new AppError({
        code: ERROR_CODES.AI_REQUEST_FAILURE,
        message: "OPENROUTER_API_KEY and OPENROUTER_MODEL must be configured.",
        statusCode: 500,
        fatal: true,
      });
    }

    const body = {
      model: config.openRouter.model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: JSON.stringify(input.context) },
      ],
      response_format: { type: "json_object" },
      temperature: config.openRouter.temperature,
      max_tokens: config.openRouter.maxOutputTokens,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= config.openRouter.maxRetries; attempt += 1) {
      try {
        const response = await withTimeout(
          fetch(`${config.openRouter.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${config.openRouter.apiKey}`,
              ...(config.openRouter.siteUrl ? { "HTTP-Referer": config.openRouter.siteUrl } : {}),
              ...(config.openRouter.appName ? { "X-Title": config.openRouter.appName } : {}),
            },
            body: JSON.stringify(body),
          }),
          config.openRouter.timeoutMs,
          "OpenRouter request timed out.",
        );

        if (!response.ok) {
          throw new Error(`OpenRouter responded with ${response.status}`);
        }

        const data = await response.json() as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("OpenRouter response did not include content.");
        return JSON.parse(content);
      } catch (error) {
        lastError = error;
      }
    }

    throw new AppError({
      code: ERROR_CODES.AI_REQUEST_FAILURE,
      message: "OpenRouter request failed.",
      statusCode: 502,
      details: redactSecrets(lastError instanceof Error ? lastError.message : String(lastError)),
    });
  }
}
