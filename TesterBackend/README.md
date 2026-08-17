# TesterBackend

TesterBackend is the server-side website tester in VoisWith. It performs **authorized, black-box functional testing** of websites with Express 5, TypeScript, Playwright-controlled Chrome, and optional OpenRouter planning. It crawls only the permitted scope, observes the browser, runs safe deterministic checks, optionally plans form cases with AI, and produces structured JSON reports and artifacts.

> **Important:** use this service only on systems you own or have clear permission to test. Every request must explicitly confirm authorization. Form submission also needs a separate write-action acknowledgment.

For the complete HTTP and WebSocket contract, see [Swagger.md](Swagger.md). Interactive Swagger UI is available at `/docs`, and the machine-readable OpenAPI 3.1 document is available at `/openapi.json`.

## Contents

- [Main capabilities](#main-capabilities)
- [How a run works](#how-a-run-works)
- [Safety and security](#safety-and-security)
- [Requirements and installation](#requirements-and-installation)
- [Configuration](#configuration)
- [Running the service](#running-the-service)
- [Test-type coverage](#test-type-coverage)
- [Reports and artifacts](#reports-and-artifacts)
- [AI form planning](#ai-form-planning)
- [Project architecture](#project-architecture)
- [Scripts and tests](#scripts-and-tests)
- [Operational notes](#operational-notes)

## Main capabilities

- Synchronous and asynchronous test runs.
- Depth-first crawling with page, depth, time, origin, include-pattern, and exclude-pattern limits.
- URL normalization, route-family grouping, state fingerprints, and duplicate-form detection.
- Page, link, form, validation, console, network, performance, and basic accessibility checks.
- Optional authentication and a role/viewport/locale matrix.
- Safe AI-assisted form planning with strict input and output contracts.
- Policy checks that block destructive, payment, privileged, or unacknowledged write actions.
- Screenshots, traces, observations, page reports, a final report, and a recoverable run manifest.
- Live progress, screenshots, cursor events, pause/resume/stop controls, and reconnect replay over WebSocket.
- Retained run history and recovery of interrupted runs after a process restart.

This is not a penetration-testing, load-testing, full WCAG-certification, or cross-browser system. Passive security observations do not prove that a target is secure.

## How a run works

The main runtime path is:

```text
validate and normalize request
-> confirm authorization and optional write acknowledgment
-> apply HTTPS, DNS/IP, private-network, and origin policy
-> create run manifest and artifact folders
-> launch Playwright Chrome
-> authenticate when credentials or roles are supplied
-> build role × viewport × locale execution targets
-> crawl permitted pages with DFS
-> canonicalize URLs and avoid loops/duplicate states
-> inspect visible elements, forms, links, and assets
-> collect console, network, timing, screenshot, and trace evidence
-> run deterministic baseline and link checks
-> classify and deduplicate forms
-> optionally create schema-constrained AI form plans
-> use deterministic form plans when AI is unavailable or fails
-> enforce action policy and execute cases one at a time
-> reload the page between form cases
-> evaluate observable outcomes
-> checkpoint each page report
-> aggregate issues, coverage, diagnostics, and the final report
```

The synchronous endpoint waits for this pipeline. The asynchronous endpoint immediately returns a run ID, performs the same work in the background, and makes state available through REST and WebSocket.

## Safety and security

### Authorization gate

Every run requires the literal value:

```json
{ "authorizationConfirmed": true }
```

A missing or false value fails request validation.

### Form-write gate

Form submission is disabled by default. If `execution.allowFormSubmission` is `true`, the top-level `writeActionsAcknowledged` must also be `true`, whether or not credentials are supplied (including an anonymous run):

```json
{
  "authorizationConfirmed": true,
  "writeActionsAcknowledged": true,
  "execution": { "allowFormSubmission": true }
}
```

The action policy separately considers safe mode, submission, upload, destructive-action, and payment settings. Privileged forms may receive a hard block (not planned or filled) or a soft block (may be filled but not submitted). A test result can therefore be `BLOCKED_BY_POLICY`; this is different from a product failure.

### Target and crawl scope

- The target origin becomes the default allowlist.
- `allowedOrigins` can add explicitly authorized origins; values are normalized to origins.
- `includeSubdomains` can widen an allowed host to its subdomains.
- `crawl.sameOriginOnly` normally stays enabled. Supplying explicit `allowedOrigins` permits the normalized multi-origin scope.
- The scope policy applies include/exclude patterns and rejects unsafe schemes or out-of-scope navigation.
- DNS is resolved before navigation. By default private, loopback, link-local, multicast, unspecified, and other forbidden addresses are rejected.
- HTTPS is required by default. Local fixture tests must explicitly set `ALLOW_PRIVATE_NETWORK_TARGETS=true` and `REQUIRE_HTTPS=false`.
- URL canonicalization removes fragments, normalizes paths and query order, drops configured tracking parameters, and detects likely pagination/query loops.

### Secret handling

Credentials are used only for browser login. Request logging redacts credentials, roles, authorization/cookie headers, and known secret keys. Values matching password, token, API-key, cookie, and authorization names are recursively redacted from events, errors, manifests, and reports. The sanitized form snapshot sent to AI contains stable element IDs and visible metadata, not credentials, field values, hidden inputs, Playwright selectors, or the full target URL.

### HTTP protection

The application disables `X-Powered-By`, uses Helmet, accepts JSON bodies up to 512 KB, adds request IDs, restricts CORS to configured frontend origins plus the built-in localhost origins, and rate-limits the service to 30 HTTP requests per minute per client. WebSocket browser origins are checked separately.

## Requirements and installation

- Node.js 20 or later.
- npm.
- Google Chrome installed through Playwright.
- An OpenRouter API key only if AI planning is wanted.

From `TesterBackend`:

```bash
npm install
npm run playwright:install:chrome
cp ../.env.example .env   # or create TesterBackend/.env yourself
npm run dev
```

Environment loading is anchored to `TesterBackend/.env`, independent of the shell working directory. Real environment variables take precedence. Never commit `.env`.

The default port is `3000`, so the useful local URLs are:

```text
http://localhost:3000/health
http://localhost:3000/docs
http://localhost:3000/openapi.json
```

`AUTO_OPEN_SWAGGER=true` attempts to open `/docs` in the operating-system browser when the server starts. Disable it on headless servers.

## Configuration

All values are optional unless a feature says otherwise.

### Server and logging

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production`. |
| `PORT` | `3000` | HTTP and WebSocket port. |
| `LOG_LEVEL` | `info` | Pino log level. |
| `FRONTEND_ORIGINS` | localhost ports `3000,3001,5173` | Comma-separated allowed browser origins. |
| `AUTO_OPEN_SWAGGER` | `true` | Open Swagger UI after startup. |

### OpenRouter and planning

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | empty | Enables AI planning when present. |
| `OPENROUTER_API_URL` | derived | Full chat-completions URL; overrides the base URL. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Base URL; `/chat/completions` is appended. |
| `OPENROUTER_MODEL` | first configured model | Preferred pinned model. |
| `OPENROUTER_MODELS` | empty | Comma-separated fallback models. |
| `OPENROUTER_TIMEOUT_MS` | `300000` | Provider timeout; legacy `AI_RESPONSE_TIMEOUT_MS` is also accepted. |
| `OPENROUTER_HTTP_REFERER` | unset | Optional OpenRouter referer; `OPENROUTER_SITE_URL` is a legacy alias. |
| `OPENROUTER_APP_TITLE` | `VoisWith Website Tester` | Provider app title; `OPENROUTER_APP_NAME` is a legacy alias. |
| `AI_CALL_PACING_MS` | `1500` | Delay between provider calls. |
| `PROMPT_FILE_PATH` | `src/prompts/form-test-planner.system.md` | Canonical system prompt. |
| `MAX_AI_CALLS_PER_RUN` | `25` | Maximum provider requests per run; `0` disables AI. |
| `MAX_AI_TEST_CASES_PER_RUN` | `400` | Maximum retained AI or fallback form cases. |

### Browser and limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `BROWSER_CHANNEL` | `chrome` | Only Chrome is supported. `PLAYWRIGHT_CHANNEL` overrides it. |
| `BROWSER_HEADLESS` | `false` | Default browser visibility. `PLAYWRIGHT_HEADLESS` overrides it. |
| `BROWSER_LAUNCH_TIMEOUT_MS` | `30000` | Browser launch timeout. |
| `PAGE_NAVIGATION_TIMEOUT_MS` | `30000` | Page navigation timeout. `NAVIGATION_TIMEOUT_MS` overrides it. |
| `ACTION_TIMEOUT_MS` | `10000` | Individual browser-action timeout. |
| `MAX_CONCURRENT_RUNS` | `1` | Maximum active async runs. |
| `MAX_PAGES_PER_RUN` | `500` | Server ceiling, range 1–500. |
| `MAX_DEPTH_PER_RUN` | `7` | Server ceiling, range 0–7. |
| `MAX_ACTIONS_PER_PAGE` | `15` | Server action budget. |
| `MAX_RUN_DURATION_SECONDS` | `10800` | Server duration ceiling, range 10–10800. |

Request values are additionally constrained by the server ceilings. A browser can be selected with the modern top-level `browserMode` (`headed` or `headless`) or the legacy `browser.headless`; `browserMode` wins.

### Security, artifacts, and live view

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALLOW_PRIVATE_NETWORK_TARGETS` | `false` | Permit private/local targets. Use only in controlled environments. |
| `REQUIRE_HTTPS` | `true` | Reject non-HTTPS targets. |
| `TEST_RUN_ALLOWED_ORIGINS` | empty | Server-wide comma-separated crawl origins. |
| `ARTIFACT_ROOT` | `artifacts` | Root for manifests and reports. |
| `ARTIFACT_RETENTION_DAYS` | `14` | Age after which startup sweeping deletes completed runs. |
| `SCREENSHOT_DIRECTORY` | `artifacts/screenshots` | Screenshot directory configuration. |
| `TRACE_DIRECTORY` | `artifacts/traces` | Trace directory configuration. |
| `LIVE_VIEW_ENABLED` | `true` | Permit live frames/cursor support. |
| `LIVE_VIEW_FRAME_INTERVAL_MS` | `1500` | Minimum live-frame interval. |

Invalid environment values stop startup with a readable list of Zod validation errors.

## Running the service

```bash
npm run dev       # watch TypeScript with tsx
npm run build     # compile to dist/
npm start         # run dist/src/server.js
```

The HTTP server uses a 30-second request timeout and a 35-second header timeout. Long test work should use the async endpoint; the synchronous endpoint is mainly convenient for direct integrations and controlled runs.

Minimal async request:

```bash
curl -X POST http://localhost:3000/api/v1/testing/runs \
  -H 'content-type: application/json' \
  -d '{
    "targetUrl":"https://example.com",
    "authorizationConfirmed":true,
    "testTypes":["SMOKE","PAGE_DISCOVERY","LINKS"],
    "browserMode":"headless",
    "visualizationMode":"off"
  }'
```

See [Swagger.md](Swagger.md) for every input field, endpoint, response, error, lifecycle control, and WebSocket message.

## Test-type coverage

There are 25 accepted test types. Selecting a partial or planned type is valid: it creates a `coverageLimitations` row rather than pretending that the capability ran.

| Test type | Availability | What the current project does |
| --- | --- | --- |
| `SMOKE` | Implemented, default | Confirms that pages load and can be inspected. |
| `PAGE_DISCOVERY` | Implemented, default | Discovers permitted same-origin pages within crawl budgets. |
| `NAVIGATION` | Implemented, default | Checks observed navigation candidates. |
| `LINKS` | Implemented, default | Inventories links and performs dedicated health checks. |
| `FORMS` | Implemented, default | Inventories forms and safely plans/executes eligible cases. |
| `FORM_VALIDATION` | Implemented, default | Checks visible validation and planned safe invalid/boundary cases. |
| `AUTHENTICATION` | Implemented, default | Attempts configured login or records skip/human-required/failure diagnostics. |
| `API_NETWORK` | Implemented, default | Reports observed API-like calls and failed requests. |
| `ERROR_HANDLING` | Implemented, default | Reports visible, browser, and network error states. |
| `PERFORMANCE_BASIC` | Implemented, default | Collects basic page timing; it is not load testing. |
| `CONSOLE_ERRORS` | Implemented, default | Captures browser console errors and warnings. |
| `ACCESSIBILITY_TECHNICAL` | Implemented, default | Checks basic automation-visible accessibility signals. |
| `PASSIVE_SECURITY` | Implemented, opt-in | Makes non-exploitative observations such as HTTPS/browser warnings. |
| `SESSION` | Partial | Records observable authenticated/session prerequisites. |
| `AUTHORIZATION` | Partial | Compares role crawl results when two or more roles exist. |
| `CHROMIUM_COMPATIBILITY` | Partial | Proves only Playwright-controlled Chrome behavior. |
| `POSITIVE` | Planned | No general happy-path workflow engine. |
| `NEGATIVE` | Planned | No general invalid-input workflow coverage. |
| `BOUNDARY` | Planned | No general boundary-combination coverage. |
| `END_TO_END` | Planned | No deterministic cross-page business-flow engine. |
| `BUSINESS_RULES` | Planned | Cannot prove unobservable business rules. |
| `FILE_UPLOAD_SAFE` | Planned | Upload types exist, but full deterministic proof is not available. |
| `DATA_INTEGRITY_OBSERVABLE` | Planned | Needs safe write/readback workflows. |
| `RELIABILITY_BASIC` | Planned | Repeatability coverage is not deterministic. |
| `REGRESSION_BASELINE` | Planned | No baseline input is currently supported. |

`coverageLimitations` contains exactly one entry for every selected type with `availability`, `executed`, and an honest `reason`.

## Reports and artifacts

### Status model

The report separates run completion from the conclusion:

| Field | Values | Meaning |
| --- | --- | --- |
| `runStatus` | `COMPLETED`, `STOPPED`, `ERRORED` | How execution ended. |
| `findingsStatus` | `PASSED`, `ISSUES_FOUND`, `INCONCLUSIVE` | What was concluded about the target. |
| `status` | `PASSED`, `FAILED`, `PARTIAL`, `ERROR`, `INCONCLUSIVE` | Deprecated compatibility alias. |

Alias mapping: completed/passed → `PASSED`; completed/issues → `FAILED`; completed/inconclusive → `INCONCLUSIVE`; stopped → `PARTIAL`; errored → `ERROR`. New clients should use the first two fields.

Individual tests use `PASSED`, `FAILED`, `SKIPPED`, `BLOCKED_BY_POLICY`, `INCONCLUSIVE`, or `ERROR`. `INCONCLUSIVE` means that no reliable outcome was observable; it is never counted as a pass.

### Stop reasons (`stoppedReason`)

- `converged`: normal finish; no permitted work remained.
- `page_budget`: page maximum reached.
- `depth_budget`: depth prevented remaining work.
- `time_budget`: duration reached.
- `user_stopped`: stop endpoint was used.
- `error`: execution failed or an interrupted manifest was recovered.

An exhausted AI budget never stops a run, and there is no `ai_budget` value. Deterministic work continues, and dropped cases are reported as budget truncation.

### Storage layout and recovery

Each run uses `ARTIFACT_ROOT/<runId>/`. The run history store creates `manifest.json`, a `reports/` directory, per-page report files, planned-case files, and the final `reports/report.json`. Evidence references can describe screenshots, traces, network, console, report, download, or fixture files and include their sizes.

The manifest is written atomically and checkpointed after each completed page. On startup, a manifest with no terminal state is rebuilt from completed page reports and finalized as `ERRORED` with `stoppedReason: "error"`. History is returned newest-first. Runs older than `ARTIFACT_RETENTION_DAYS` are swept at startup. Credentials are removed before the request is persisted.

The final report includes run metadata, selected types, stop reason, summary counters, page reports, deduplicated issues, coverage rows, evidence, and diagnostics. Diagnostics cover browser launch, matrix targets, authorization comparisons, crawl/skipped/unreached pages, blocked actions, AI attempts/budgets, artifacts, and timestamped internal events.

## AI form planning

OpenRouter is optional. With no key, or with `MAX_AI_CALLS_PER_RUN=0`, deterministic crawling and testing remain active and the event stream explains why AI was skipped.

1. Visible inspected forms become sanitized `FormSnapshot` objects.
2. Forms are classified for privileged/destructive/payment signals and deduplicated across pages.
3. Snapshots are batched (normally three forms, also bounded by estimated context size) and sent sequentially.
4. The canonical Markdown prompt and `{ formCount, forms }` are sent to OpenRouter with strict JSON-schema response formatting.
5. Output is validated strictly: unknown properties, unknown form IDs, unknown element IDs, excessive values, or invalid expected outcomes are rejected.
6. The retry ladder uses the normal request, a repair request, another configured model, and then deterministic generation.
7. Validated plans are saved before interaction, exposed on page reports, and executed sequentially.
8. The page reloads between cases. Submissions enter a visible hold stage before the final action and remain governed by request and form policy.
9. Outcome evaluation looks for navigation, validation, success/error messages, network results, and other observable facts. If evidence is insufficient, the result is `INCONCLUSIVE`.

The plan contract permits up to 12 validated cases per form and generated values up to 500 characters. Expected outcomes are observable categories such as validation, accepted submission/navigation, success/error message, no crash, or no sensitive-data exposure.

`src/ai/qwen-client.ts` and `scripts/qwen-smoke.mjs` contain a separate Qwen-compatible client/smoke implementation. The production `config.ai.provider` and orchestrator are currently wired to OpenRouter; Qwen is not selected by the documented runtime environment schema or npm scripts.

## Project architecture

### Application and API

- `src/server.ts`: initializes retained history, creates the HTTP server, attaches WebSocket upgrades, listens, optionally opens Swagger, and performs signal shutdown.
- `src/app.ts`: Express middleware, CORS, security headers, JSON limits, rate limiting, Swagger, health, routes, and centralized errors.
- `src/controllers/testing.controller.ts`: validates bodies and implements sync, async, history, lifecycle, and report-download controllers.
- `src/routes/testing.routes.ts`: REST route table.
- `src/docs/`: OpenAPI document and Swagger UI registration.
- `src/middleware/`, `src/errors/`, `src/utilities/`: request IDs, error serialization, async wrappers, timeout helpers, and route-family utilities.

### Browser, crawl, and inspection

- `src/browser/`: Chrome lifecycle, contexts/pages, live frames, and optional local cursor visualization.
- `src/crawler/`: DFS, scope decisions, URL canonicalization/loop avoidance, and state fingerprints.
- `src/inspection/`: stable element inventory and page snapshots for links, assets, forms, and UI observations.
- `src/authentication/`: login-page detection, hinted/fallback selector ordering, filling, submit, and outcome diagnostics.
- `src/collectors/`: console, network, performance, screenshots, traces, and evidence references.

### Planning, execution, and assertions

- `src/ai/`: snapshot sanitization, batching, prompt loading, OpenRouter/Qwen clients, plan validation, and planner fallback handling.
- `src/schemas/` and `src/types/`: runtime Zod contracts and TypeScript contracts for requests, plans, events, and reports.
- `src/actions/`: locator resolution, Playwright actions, and action-policy decisions.
- `src/safety/form-classifier.ts`: hard/soft privileged-form classification.
- `src/testing/`: matrix expansion, baseline checks, link health, generated data, deterministic plans, form deduplication, form execution, and run context.
- `src/assertions/`: low-level assertions and observable-outcome evaluation.

### Orchestration, events, and reporting

- `src/services/run-orchestrator.ts`: owns the full run and joins every subsystem.
- `src/runs/run-registry.ts`: live async state, pause/resume/stop flags, event replay, and terminal cleanup.
- `src/runs/run-history-store.ts`: atomic manifests, page checkpoints, final reports, recovery, retention, and history queries.
- `src/websocket/testing-run-stream.ts`: upgrade path, origin checks, snapshots, replay, heartbeats, and terminal close.
- `src/reporting/`: report aggregation, issue fingerprint/deduplication, and severity mapping.
- `src/security/`: SSRF/DNS defenses and recursive secret redaction.

### Other project files

- `src/prompts/form-test-planner.system.md`: strict instructions and safety rules given to the form planner.
- `scripts/`: provider smoke tests, fixture acceptance, adversarial persistence/replay checks, and the TrueForm system runner.
- `tests/unit/`: unit and contract tests for policy, AI, crawler, browser, forms, reports, history, orchestration, schemas, security, and documentation drift.
- `tests/fixtures/test-site/server.mjs`: deterministic local site with forms, redirects, errors, duplicate routes, privileged actions, and other seeded behavior.
- `tsconfig.json`: strict ES2022/NodeNext compilation into `dist`.
- `vitest.config.ts`: Node test environment, 30-second unit-test timeout.
- `eslint.config.js`, `.prettierrc`: TypeScript linting and formatting rules.

Generated or local directories (`node_modules`, `dist`, `artifacts`, coverage, Playwright reports, test results, and `.env`) are ignored by Git.

## Scripts and tests

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start a watched development server. |
| `npm run build` | Compile source and tests to `dist`. |
| `npm start` | Run the compiled server. |
| `npm test` | Run all Vitest unit/contract tests once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:ci` | Unit tests, build, then deterministic fixture acceptance. |
| `npm run lint` | Run ESLint over the project. |
| `npm run format` | Rewrite supported files with Prettier. |
| `npm run fixture` | Start the local fixture on port 43117. |
| `npm run acceptance:deterministic` | Build and test the fixture with AI disabled. |
| `npm run acceptance:live` | Build and test the fixture with live OpenRouter planning. |
| `npm run acceptance:phase5-adversarial` | Test process-kill recovery, reconnect replay, and disk/API parity. |
| `npm run openrouter:smoke` | Send one direct provider request; requires `OPENROUTER_API_KEY`. |
| `npm run trueform:system-test` | Run the remote TrueForm scenario; requires authorization and `TRUEFORM_PASSWORD`. |
| `npm run playwright:install:chrome` | Install Playwright's Chrome dependency. |

`scripts/qwen-smoke.mjs` is currently invoked directly with Node rather than through `package.json` and requires `QWEN_API_KEY`.

## Operational notes

- Async runs are limited by `MAX_CONCURRENT_RUNS`; overload is returned as HTTP 429.
- Live non-frame events use an in-memory ring of about 2,000 entries. Terminal live records remain for about ten minutes; disk history remains longer.
- Reconnect with `?lastSequence=N` to request events after the last processed sequence.
- The server sends WebSocket and JSON heartbeats every 30 seconds. Clients answer the JSON ping with `{"type":"stream.pong"}`. Two missed heartbeats close with code `4000` and reason `heartbeat_timeout`.
- Normal terminal ordering is `run.completed`, then `run.report_ready`, then a two-second grace period, then close code `1000` with reason `run_complete`.
- Live cursor traffic is not written into manifests/reports and only its newest value is retained, preventing it from evicting diagnostic events.
- Screenshots use compressed JPEG evidence. Large artifact totals are reported in diagnostics and summaries.
- The project uses ES modules. Local TypeScript imports intentionally use `.js` extensions for NodeNext output.

## License

No project license file is present in `TesterBackend`. Ask the repository owner before redistributing or reusing the code outside the repository.
