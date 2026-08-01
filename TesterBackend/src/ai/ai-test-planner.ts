import type { RunContext } from "../testing/run-context.js";
import type { TestPlan } from "../types/ai.js";
import type { PageSnapshot } from "../types/testing.js";
import { AiContextBuilder } from "./ai-context-builder.js";
import { AiResponseValidator } from "./ai-response-validator.js";
import { OpenRouterClient } from "./openrouter-client.js";
import { PromptLoader } from "./prompt-loader.js";

export class AiTestPlanner {
  private readonly contextBuilder = new AiContextBuilder();
  private readonly validator = new AiResponseValidator();
  private readonly client = new OpenRouterClient();
  private readonly prompts = new PromptLoader();

  async plan(context: RunContext, snapshot: PageSnapshot): Promise<TestPlan> {
    context.openRouterCalls += 1;
    const raw = await this.client.createStructuredPlan({
      systemPrompt: await this.prompts.load(),
      context: this.contextBuilder.build(context, snapshot),
    });
    return this.validator.validate(raw, snapshot.elements);
  }
}
