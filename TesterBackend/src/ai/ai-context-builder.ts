import type { RunContext } from "../testing/run-context.js";
import type { ElementInventoryItem, PageSnapshot } from "../types/testing.js";
import { redactSecrets } from "../security/secret-redaction.js";

const FIELD_KINDS = new Set<ElementInventoryItem["kind"]>(["input", "textarea", "select", "checkbox", "radio", "file", "search"]);

export class AiContextBuilder {
  build(context: RunContext, snapshot: PageSnapshot): unknown {
    const forms = snapshot.forms.map((form) => ({
      formId: form.elementId,
      implicit: form.implicit,
      method: form.method,
      action: form.action,
      apparentPurpose: form.apparentPurpose,
      fields: form.fields.map(fieldForAi),
      submitControls: form.submitControls.map(controlForAi),
    }));

    return redactSecrets({
      runId: context.runId,
      targetOrigin: context.targetOrigin,
      role: context.roleName,
      viewport: context.viewportName,
      locale: context.localeName,
      direction: context.direction,
      selectedTestTypes: context.request.testTypes.map((type) => type.toLowerCase().replace(/_/g, "-")),
      allowedOrigins: context.request.allowedOrigins ?? [context.targetOrigin],
      allowDestructiveActions: context.request.execution.allowDestructiveActions,
      validCredentialsAvailable: Boolean(context.request.credentials?.username && context.request.credentials.password),
      authenticated: Boolean(context.request.credentials),
      currentRole: context.roleName ?? "Default",
      authorizedRoles: (context.request.roles ?? []).map((role) => role.name),
      previousPageSummaries: context.previousPageSummaries.slice(-20),
      previousTestResults: context.previousTestResults.slice(-50),
      knownWorkflows: context.knownWorkflows,
      visitedUrls: [...context.visitedUrls],
      existingGeneratedTestEntities: context.generatedEntities,
      safetyRestrictions: context.request.execution,
      remainingPageBudget: context.request.crawl.maxPages ? context.request.crawl.maxPages - context.visitedUrls.size : "unbounded",
      remainingActionBudgetPerPage: context.request.execution.maximumActionsPerPage,
      safeTestDataAvailable: Object.keys(context.request.testData ?? {}).length > 0,
      page: {
        url: snapshot.url,
        title: snapshot.title,
        stateFingerprint: snapshot.stateFingerprint ?? snapshot.canonicalUrl,
        formCount: forms.length,
        inputCount: forms.reduce((sum, form) => sum + form.fields.length, 0),
        submitControlCount: forms.reduce((sum, form) => sum + form.submitControls.length, 0),
        forms,
        consoleErrors: snapshot.consoleErrors,
        failedRequests: snapshot.failedRequests,
        visibleValidationErrors: snapshot.visibleValidationErrors,
      },
    });
  }
}

function fieldForAi(field: ElementInventoryItem) {
  return {
    elementId: field.id,
    kind: FIELD_KINDS.has(field.kind) ? field.kind : "input",
    label: field.label,
    placeholder: field.placeholder,
    name: field.name,
    type: field.type,
    required: field.required,
    disabled: field.disabled,
    hidden: field.hidden,
    validation: field.validation,
    valuePlaceholder: placeholderForField(field),
  };
}

function controlForAi(control: ElementInventoryItem) {
  return {
    elementId: control.id,
    kind: control.kind,
    text: control.text,
    accessibleName: control.accessibleName,
    disabled: control.disabled,
    hidden: control.hidden,
  };
}

function placeholderForField(field: ElementInventoryItem): string {
  const type = field.type?.toLowerCase();
  if (type === "password") return "TEST_PASSWORD";
  if (type === "email") return "VALID_EMAIL";
  if (type === "url") return "VALID_URL";
  if (type === "number") return "VALID_NUMBER";
  if (type === "date") return "VALID_DATE";
  if (field.kind === "file") return "TEST_FILE";
  if (field.kind === "checkbox" || field.kind === "radio") return "BOOLEAN_CHOICE";
  return "VALID_TEXT";
}
