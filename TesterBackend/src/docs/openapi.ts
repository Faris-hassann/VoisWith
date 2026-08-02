import { TEST_TYPES } from "../testing/test-types.js";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "TesterBackend API",
    version: "1.0.0",
    description:
      "Authorized black-box functional website testing backend powered by Playwright and OpenRouter.",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        responses: {
          "200": {
            description: "Server is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/testing/run": {
      post: {
        tags: ["Testing"],
        summary: "Run authorized website testing",
        description:
          "Starts an isolated Playwright Chrome run against a website the caller confirms they are authorized to test.",
        operationId: "runWebsiteTesting",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TestingRunRequest" },
              examples: {
                smokeTest: {
                  summary: "Safe smoke test",
                  value: {
                    targetUrl: "https://example.com",
                    authorizationConfirmed: true,
                    environment: "staging",
                    testTypes: ["SMOKE", "PAGE_DISCOVERY", "LINKS", "CONSOLE_ERRORS"],
                    crawl: {
                      strategy: "DFS",
                      maxDepth: 1,
                      maxPages: 5,
                      sameOriginOnly: true,
                      includePatterns: [],
                      excludePatterns: ["/logout", "/delete", "/remove", "/payment"],
                    },
                    browser: {
                      channel: "chrome",
                      headless: false,
                      viewport: {
                        width: 1440,
                        height: 900,
                      },
                    },
                    execution: {
                      safeMode: true,
                      allowFormSubmission: true,
                      allowFileUploads: true,
                      allowDestructiveActions: false,
                      allowPayments: false,
                      maximumActionsPerPage: 15,
                      maximumRunDurationSeconds: 300,
                    },
                    testMatrix: {
                      enabled: true,
                      viewports: [
                        { name: "desktop", width: 1440, height: 900 },
                        { name: "mobile", width: 390, height: 844 },
                      ],
                      locales: [
                        { name: "english-ltr", locale: "en-US", direction: "ltr" },
                        { name: "arabic-rtl", locale: "ar", direction: "rtl" },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Structured testing report",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TestingRunResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/v1/testing/runs": {
      post: {
        tags: ["Testing"],
        summary: "Start async website testing run",
        description:
          "Starts a backend test run and returns immediately. Subscribe to /api/v1/testing/runs/{runId}/stream by WebSocket for live progress.",
        operationId: "startAsyncWebsiteTesting",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TestingRunRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Run accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AsyncRunStartResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/v1/testing/runs/{runId}": {
      get: {
        tags: ["Testing"],
        summary: "Get async testing run status",
        operationId: "getAsyncWebsiteTestingRun",
        parameters: [
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Current run state",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AsyncRunSnapshot" },
              },
            },
          },
          "404": { $ref: "#/components/responses/BadRequest" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
  },
  components: {
    responses: {
      BadRequest: {
        description: "Invalid or unsafe request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      RateLimited: {
        description: "Too many requests or concurrent runs",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      ServerError: {
        description: "Server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      AsyncRunStartResponse: {
        type: "object",
        required: ["runId", "status", "startedAt", "streamUrl"],
        properties: {
          runId: { type: "string" },
          status: { type: "string", enum: ["queued", "running", "completed", "failed"] },
          startedAt: { type: "string", format: "date-time" },
          streamUrl: { type: "string", example: "/api/v1/testing/runs/{runId}/stream" },
        },
      },
      AsyncRunSnapshot: {
        type: "object",
        required: ["runId", "status", "startedAt", "updatedAt", "events"],
        properties: {
          runId: { type: "string" },
          status: { type: "string", enum: ["queued", "running", "completed", "failed"] },
          startedAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          events: { type: "array", items: { $ref: "#/components/schemas/RunProgressEvent" } },
          report: { $ref: "#/components/schemas/TestingRunResponse" },
          error: {},
        },
      },
      RunProgressEvent: {
        type: "object",
        required: ["runId", "sequence", "type", "status", "timestamp", "message"],
        properties: {
          runId: { type: "string" },
          sequence: { type: "integer" },
          type: { type: "string", example: "page.snapshot_collected" },
          status: { type: "string", enum: ["started", "passed", "failed", "skipped", "info", "blocked"] },
          timestamp: { type: "string", format: "date-time" },
          message: { type: "string" },
          pageUrl: { type: "string" },
          role: { type: "string" },
          viewport: { type: "string" },
          locale: { type: "string" },
          counts: { type: "object", additionalProperties: { type: "number" } },
          diagnostics: {},
          issue: {},
          report: { $ref: "#/components/schemas/TestingRunResponse" },
        },
      },
      TestingRunRequest: {
        type: "object",
        additionalProperties: false,
        required: ["targetUrl", "authorizationConfirmed", "testTypes"],
        properties: {
          targetUrl: { type: "string", format: "uri", example: "https://example.com" },
          authorizationConfirmed: {
            type: "boolean",
            const: true,
            description: "Must be true. Caller confirms authorization to test the target.",
          },
          environment: { type: "string", enum: ["production", "staging"], default: "production" },
          credentials: { $ref: "#/components/schemas/Credentials" },
          roles: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { $ref: "#/components/schemas/RoleCredentials" },
          },
          testTypes: {
            type: "array",
            minItems: 1,
            items: { type: "string", enum: TEST_TYPES },
          },
          crawl: { $ref: "#/components/schemas/CrawlSettings" },
          browser: { $ref: "#/components/schemas/BrowserSettings" },
          execution: { $ref: "#/components/schemas/ExecutionSettings" },
          testMatrix: { $ref: "#/components/schemas/TestMatrixSettings" },
        },
      },
      RoleCredentials: {
        type: "object",
        additionalProperties: false,
        required: ["name", "credentials"],
        properties: {
          name: { type: "string", enum: ["Admin", "Agent", "Client"] },
          credentials: { $ref: "#/components/schemas/Credentials" },
          loginUrl: { type: "string", format: "uri" },
          fieldHints: {
            type: "object",
            additionalProperties: false,
            properties: {
              usernameSelector: { type: "string" },
              passwordSelector: { type: "string" },
              submitSelector: { type: "string" },
            },
          },
        },
      },
      Credentials: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password"],
        properties: {
          loginUrl: { type: "string", format: "uri" },
          username: { type: "string", example: "test-user@example.com" },
          password: {
            type: "string",
            format: "password",
            description: "Never logged, stored in reports, or sent to OpenRouter.",
          },
          fieldHints: {
            type: "object",
            additionalProperties: false,
            properties: {
              usernameSelector: { type: "string" },
              passwordSelector: { type: "string" },
              submitSelector: { type: "string" },
            },
          },
        },
      },
      CrawlSettings: {
        type: "object",
        additionalProperties: false,
        properties: {
          strategy: { type: "string", enum: ["DFS"], default: "DFS" },
          maxDepth: { type: "integer", minimum: 0, maximum: 20, default: 5 },
          maxPages: { type: "integer", minimum: 1, maximum: 1000, default: 5 },
          sameOriginOnly: { type: "boolean", default: true },
          includePatterns: { type: "array", items: { type: "string" }, default: [] },
          excludePatterns: {
            type: "array",
            items: { type: "string" },
            default: ["/logout", "/delete", "/remove", "/payment"],
          },
        },
      },
      BrowserSettings: {
        type: "object",
        additionalProperties: false,
        properties: {
          channel: { type: "string", enum: ["chrome"], default: "chrome" },
          headless: { type: "boolean", default: false },
          viewport: {
            type: "object",
            additionalProperties: false,
            properties: {
              width: { type: "integer", minimum: 320, maximum: 3840, default: 1440 },
              height: { type: "integer", minimum: 240, maximum: 2160, default: 900 },
            },
          },
        },
      },
      ExecutionSettings: {
        type: "object",
        additionalProperties: false,
        properties: {
          safeMode: { type: "boolean", default: true },
          allowFormSubmission: { type: "boolean", default: true },
          allowFileUploads: { type: "boolean", default: true },
          allowDestructiveActions: { type: "boolean", default: false },
          allowPayments: { type: "boolean", default: false },
          maximumActionsPerPage: { type: "integer", minimum: 1, maximum: 200, default: 15 },
          maximumRunDurationSeconds: {
            type: "integer",
            minimum: 10,
            maximum: 7200,
            default: 300,
          },
        },
      },
      TestMatrixSettings: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean", default: false },
          viewports: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "width", "height"],
              properties: {
                name: { type: "string" },
                width: { type: "integer", minimum: 320, maximum: 3840 },
                height: { type: "integer", minimum: 240, maximum: 2160 },
              },
            },
          },
          locales: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "locale", "direction"],
              properties: {
                name: { type: "string" },
                locale: { type: "string" },
                direction: { type: "string", enum: ["ltr", "rtl"] },
              },
            },
          },
        },
      },
      TestingRunResponse: {
        type: "object",
        properties: {
          runId: { type: "string" },
          status: {
            type: "string",
            enum: ["PASSED", "FAILED", "PARTIAL", "ERROR", "INCONCLUSIVE"],
          },
          startedAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          targetOrigin: { type: "string" },
          selectedTestingTypes: { type: "array", items: { type: "string", enum: TEST_TYPES } },
          summary: { type: "object" },
          pages: { type: "array", items: { type: "object" } },
          issues: { type: "array", items: { type: "object" } },
          coverageLimitations: { type: "array", items: { type: "object" } },
          artifacts: { type: "array", items: { type: "object" } },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
