import type { TestingRunRequest } from "../api/types";
import type { TestingFormValues } from "../schemas/testing-run.schema";

export function buildTestingPayload(values: TestingFormValues): TestingRunRequest {
  const payload: TestingRunRequest = {
    targetUrl: values.targetUrl.trim(),
    authorizationConfirmed: true,
    testTypes: values.testTypes,
    crawl: {
      strategy: "DFS",
      maxDepth: values.crawl.maxDepth,
      maxPages: values.crawl.maxPages,
      sameOriginOnly: values.crawl.sameOriginOnly,
      includePatterns: splitPatterns(values.crawl.includePatternsText),
      excludePatterns: splitPatterns(values.crawl.excludePatternsText),
    },
    browser: values.browser,
    execution: {
      ...values.execution,
      allowDestructiveActions: false,
      allowPayments: false,
    },
  };

  if (values.authenticationEnabled && values.credentials.username && values.credentials.password) {
    payload.credentials = {
      username: values.credentials.username,
      password: values.credentials.password,
      ...(values.credentials.loginUrl ? { loginUrl: values.credentials.loginUrl } : {}),
      ...(values.credentials.usernameSelector || values.credentials.passwordSelector || values.credentials.submitSelector
        ? {
            fieldHints: {
              ...(values.credentials.usernameSelector ? { usernameSelector: values.credentials.usernameSelector } : {}),
              ...(values.credentials.passwordSelector ? { passwordSelector: values.credentials.passwordSelector } : {}),
              ...(values.credentials.submitSelector ? { submitSelector: values.credentials.submitSelector } : {}),
            },
          }
        : {}),
    };
  }

  return payload;
}

export function splitPatterns(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
