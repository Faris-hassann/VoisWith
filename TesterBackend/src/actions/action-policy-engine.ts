import type { PolicyDecision, TestAction, TestCase } from "../types/ai.js";
import type { ElementInventoryItem, TestingRunRequest } from "../types/testing.js";

const BLOCKED_TERMS = [
  "delete",
  "remove",
  "deactivate",
  "terminate",
  "cancel subscription",
  "publish",
  "send",
  "invite",
  "email",
  "sms",
  "whatsapp",
  "payment",
  "purchase",
  "checkout",
  "transfer",
  "refund",
  "withdrawal",
  "password",
  "role",
  "permission",
  "configuration",
  "legal",
  "close account",
];

const STAGING_ONLY_TERMS = [
  "booking",
  "book",
  "appointment",
  "ticket",
  "e-signature",
  "esignature",
  "signature",
  "otp",
  "upload",
  "file",
  "payment",
  "checkout",
  "card",
  "billing",
];

export class ActionPolicyEngine {
  decide(input: {
    action: TestAction;
    testCase: TestCase;
    request: TestingRunRequest;
    element?: ElementInventoryItem;
  }): PolicyDecision {
    const text = [
      input.testCase.name,
      input.testCase.reasoningSummary,
      input.action.description,
      input.action.value,
      input.element?.text,
      input.element?.accessibleName,
      input.element?.label,
      input.element?.placeholder,
      input.element?.formAction,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (input.testCase.destructive && !input.request.execution.allowDestructiveActions) {
      return { allowed: false, status: "BLOCKED_BY_POLICY", reason: "Destructive test case blocked." };
    }
    if (!input.request.execution.allowFormSubmission && ["SUBMIT"].includes(input.action.action)) {
      return { allowed: false, status: "BLOCKED_BY_POLICY", reason: "Form submission disabled." };
    }
    if (!input.request.execution.allowFileUploads && input.action.action === "UPLOAD_SAFE_FIXTURE") {
      return { allowed: false, status: "BLOCKED_BY_POLICY", reason: "File uploads disabled." };
    }
    if (
      (input.request.environment ?? "production") !== "staging" &&
      (["SUBMIT", "UPLOAD_SAFE_FIXTURE"].includes(input.action.action) ||
        (input.action.action === "CLICK" && STAGING_ONLY_TERMS.some((term) => text.includes(term))))
    ) {
      return {
        allowed: false,
        status: "BLOCKED_BY_POLICY",
        reason: "Sensitive workflow action requires environment=staging.",
      };
    }
    if (input.request.execution.safeMode && BLOCKED_TERMS.some((term) => text.includes(term))) {
      return {
        allowed: false,
        status: "BLOCKED_BY_POLICY",
        reason: "Action matched a safe-mode blocked operation.",
      };
    }
    if (!input.request.execution.allowPayments && /payment|purchase|checkout|card|billing/.test(text)) {
      return { allowed: false, status: "BLOCKED_BY_POLICY", reason: "Payment-like action blocked." };
    }
    if (input.action.action === "NAVIGATE" && input.action.url) {
      const target = new URL(input.request.targetUrl);
      const next = new URL(input.action.url, input.request.targetUrl);
      if (input.request.crawl.sameOriginOnly && next.origin !== target.origin) {
        return { allowed: false, status: "BLOCKED_BY_POLICY", reason: "External navigation blocked." };
      }
    }
    return { allowed: true, status: "APPROVED" };
  }
}
