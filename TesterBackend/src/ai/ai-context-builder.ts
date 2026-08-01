import type { RunContext } from "../testing/run-context.js";
import type { PageSnapshot } from "../types/testing.js";
import { redactSecrets } from "../security/secret-redaction.js";

export class AiContextBuilder {
  build(context: RunContext, snapshot: PageSnapshot): unknown {
    return redactSecrets({
      runId: context.runId,
      targetOrigin: context.targetOrigin,
      selectedTestingTypes: context.request.testTypes,
      previousPageSummaries: context.previousPageSummaries.slice(-20),
      previousTestResults: context.previousTestResults.slice(-50),
      knownWorkflows: context.knownWorkflows,
      visitedUrls: [...context.visitedUrls],
      existingGeneratedTestEntities: context.generatedEntities,
      safetyRestrictions: context.request.execution,
      remainingPageBudget: context.request.crawl.maxPages - context.visitedUrls.size,
      remainingActionBudgetPerPage: context.request.execution.maximumActionsPerPage,
      pageSnapshot: snapshot,
    });
  }
}
