export const TEST_TYPES = [
  "SMOKE",
  "PAGE_DISCOVERY",
  "NAVIGATION",
  "LINKS",
  "FORMS",
  "FORM_VALIDATION",
  "POSITIVE",
  "NEGATIVE",
  "BOUNDARY",
  "AUTHENTICATION",
  "SESSION",
  "AUTHORIZATION",
  "END_TO_END",
  "BUSINESS_RULES",
  "API_NETWORK",
  "ERROR_HANDLING",
  "FILE_UPLOAD_SAFE",
  "DATA_INTEGRITY_OBSERVABLE",
  "PERFORMANCE_BASIC",
  "RELIABILITY_BASIC",
  "CHROMIUM_COMPATIBILITY",
  "PASSIVE_SECURITY",
  "REGRESSION_BASELINE",
  "CONSOLE_ERRORS",
  "ACCESSIBILITY_TECHNICAL",
] as const;

export type TestingType = (typeof TEST_TYPES)[number];

export const TEST_TYPE_CAPABILITIES: Record<TestingType, { proves: string; cannotProve: string }> = {
  SMOKE: {
    proves: "Core pages load and basic interactions are reachable.",
    cannotProve: "Deep workflow correctness or full regression coverage.",
  },
  PAGE_DISCOVERY: {
    proves: "Same-origin pages can be discovered within configured crawl limits.",
    cannotProve: "Hidden or unauthenticated routes not linked in the observed UI.",
  },
  NAVIGATION: {
    proves: "Observed navigation controls work within permitted scope.",
    cannotProve: "Every possible route or user journey.",
  },
  LINKS: {
    proves: "Observed links are reachable or produce reportable failures.",
    cannotProve: "External destination correctness unless explicitly enabled.",
  },
  FORMS: {
    proves: "Observed forms accept safe generated values and expose validation behavior.",
    cannotProve: "Backend business correctness beyond observable responses.",
  },
  FORM_VALIDATION: {
    proves: "Visible validation behavior for selected safe empty, invalid, and boundary inputs.",
    cannotProve: "All server-side validation branches.",
  },
  POSITIVE: {
    proves: "Selected happy-path flows work with valid safe data.",
    cannotProve: "All valid input permutations.",
  },
  NEGATIVE: {
    proves: "Selected invalid safe inputs are handled without obvious failures.",
    cannotProve: "Exploit resistance or hostile-input security posture.",
  },
  BOUNDARY: {
    proves: "Selected field boundaries behave as expected.",
    cannotProve: "All numeric, date, and length boundary combinations.",
  },
  AUTHENTICATION: {
    proves: "Configured login can complete or identify a human-auth blocker.",
    cannotProve: "Authentication security strength.",
  },
  SESSION: {
    proves: "Basic observable session behavior after login.",
    cannotProve: "Full session fixation, revocation, or timeout security.",
  },
  AUTHORIZATION: {
    proves: "Skipped in v1 unless future role sessions are supplied.",
    cannotProve: "Role isolation with a single credential set.",
  },
  END_TO_END: {
    proves: "AI-identified safe workflows can execute across observed pages.",
    cannotProve: "All real business scenarios.",
  },
  BUSINESS_RULES: {
    proves: "Observable business rules surfaced in the UI for selected flows.",
    cannotProve: "Unobservable backend invariants.",
  },
  API_NETWORK: {
    proves: "Observed network calls complete or fail during UI workflows.",
    cannotProve: "Undocumented API correctness or fuzzing results.",
  },
  ERROR_HANDLING: {
    proves: "Observed UI/network errors are collected.",
    cannotProve: "All exception paths.",
  },
  FILE_UPLOAD_SAFE: {
    proves: "Safe fixture upload controls behave as observed.",
    cannotProve: "File upload exploit resistance.",
  },
  DATA_INTEGRITY_OBSERVABLE: {
    proves: "Created or changed data is visible where safely observable.",
    cannotProve: "Database-level integrity.",
  },
  PERFORMANCE_BASIC: {
    proves: "Basic page timing, slow requests, and failed resources.",
    cannotProve: "Load, stress, spike, endurance, or scalability behavior.",
  },
  RELIABILITY_BASIC: {
    proves: "Selected flows can be repeated within the run budget.",
    cannotProve: "Long-term availability.",
  },
  CHROMIUM_COMPATIBILITY: {
    proves: "Behavior in Playwright-controlled Chrome.",
    cannotProve: "Cross-browser compatibility.",
  },
  PASSIVE_SECURITY: {
    proves: "Passive observations such as HTTPS, headers, sensitive URLs, and browser warnings.",
    cannotProve: "Vulnerability exploitability.",
  },
  REGRESSION_BASELINE: {
    proves: "Skipped in v1 unless a baseline is later supplied.",
    cannotProve: "Regression status without a baseline.",
  },
  CONSOLE_ERRORS: {
    proves: "Console errors observed during tested workflows.",
    cannotProve: "User-visible impact of every console event.",
  },
  ACCESSIBILITY_TECHNICAL: {
    proves: "Basic technical accessibility signals exposed to automation.",
    cannotProve: "Full WCAG conformance or user experience quality.",
  },
};
