import { AutomationPlan, AutomationStep } from '../shared/types.js';

const credentialPatterns = [/password\s*(?:is|=|:)\s*([^\s,.]+)/i, /username\s*(?:is|=|:)\s*([^\s,.]+)/i, /login\s*button/i, /submit/i];

export function hasCredentials(text: string): boolean {
  return credentialPatterns.slice(0, 2).some((pattern) => pattern.test(text));
}

export function markSensitiveSteps(steps: AutomationStep[]): AutomationStep[] {
  return steps.map((step) => {
    const sensitive = Boolean(step.value && /password|pass|secret|token/i.test(step.description + step.target + step.selectorName));
    const requiresConfirmation = sensitive || /login|submit|sign in/i.test(step.description + step.target);
    return { ...step, sensitive, requiresConfirmation };
  });
}

export function validatePlan(plan: AutomationPlan): AutomationPlan {
  const warnings = [...plan.warnings];
  if (plan.steps.some((step) => step.sensitive)) warnings.push('Credentials detected. Values are masked in logs and should be replaced with UiPath secure credential assets.');
  if (plan.steps.some((step) => step.requiresConfirmation)) warnings.push('Some actions require explicit user confirmation before execution.');
  return { ...plan, warnings: [...new Set(warnings)], requiresConfirmation: plan.steps.some((s) => s.requiresConfirmation) };
}
