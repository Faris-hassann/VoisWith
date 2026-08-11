# TesterBackend

TesterBackend is an Express 5, TypeScript, Playwright, and OpenRouter-backed AI planning backend for authorized black-box functional testing of websites and web applications.

Part of the [VoisWith repository overview](../README.md).

## What Runs Now

The backend exposes:

```text
GET  /docs
GET  /openapi.json
GET  /health
POST /api/v1/testing/run
POST /api/v1/testing/runs
GET  /api/v1/testing/runs/:runId
POST /api/v1/testing/runs/:runId/pause
POST /api/v1/testing/runs/:runId/resume
POST /api/v1/testing/runs/:runId/stop
GET  /api/v1/testing/runs/:runId/report.json
WS   /api/v1/testing/runs/:runId/stream
```

`POST /api/v1/testing/run` is synchronous and returns the completed JSON report. `POST /api/v1/testing/runs` starts an async run, returns a run ID immediately, and streams progress over WebSocket.

`GET /api/v1/testing/runs` returns `{ runs: RunHistoryItem[] }` newest-first from the 14-day disk-backed retention window. `GET /api/v1/testing/runs/:runId` and `/report.json` fall back to the persisted manifest/report after restart or registry eviction.

The runtime pipeline is:

```text
validate request and authorization flag
-> reject unsafe targets by SSRF/HTTPS policy
-> create artifact directory
-> launch Playwright Chrome
-> optionally authenticate
-> build role/viewport/locale matrix
-> crawl allowed pages with DFS
-> inspect pages and collect links, forms, console, network, performance, screenshots
-> run deterministic baseline checks
-> optionally ask OpenRouter for schema-constrained form test cases
-> save the validated test-case plan as a run artifact
-> execute each case sequentially and reload the form between cases
-> write per-page report artifacts
-> aggregate final report and diagnostics
```

OpenRouter is optional at runtime. If `MAX_AI_CALLS_PER_RUN=0`, the backend still performs deterministic crawl, inventory, and baseline checks and emits `ai:disabled` / `ai.skipped_budget` events.

## Authorization Gate

Every run request must include:

```json
{
  "authorizationConfirmed": true
}
```

The schema rejects any request where `authorizationConfirmed` is missing or not literally `true`.

Target authorization is also constrained by an allowlist:

- By default, `allowedOrigins` becomes the origin of `targetUrl`.
- Request-level `allowedOrigins` may add explicit target origins.
- `includeSubdomains` can widen matching for configured origins.
- `crawl.sameOriginOnly` stays true unless explicit `allowedOrigins` are supplied.
- WebSocket browser origins are allowed when they match `FRONTEND_ORIGINS` or the built-in local frontend origins: `http://localhost:3000`, `http://localhost:3001`, `http://localhost:5173`.

Only test systems you own or are explicitly authorized to test.

## Write Acknowledgment

`execution.allowFormSubmission` defaults to `false`. Whenever it is `true`, the request must also carry:

```json
{
  "allowFormSubmission": true,
  "writeActionsAcknowledged": true
}
```

The acknowledgment is required **regardless of whether credentials are supplied**. Anonymous form submission can create or modify data just as a credentialed session can, so both paths gate on the same flag. A request with `allowFormSubmission: true` and a missing or non-`true` `writeActionsAcknowledged` is rejected by the schema.

## Test-Type Availability

Test types fall into four tiers. The 12 implemented-and-default types are the ones checked by default in the frontend selector; every other type must be selected deliberately.

| Test type | Tier | Current behavior |
| --- | --- | --- |
| `SMOKE` | Implemented (default) | Verifies the page loads and can be inspected. |
| `PAGE_DISCOVERY` | Implemented (default) | Inventories same-origin links for DFS discovery. |
| `NAVIGATION` | Implemented (default) | Checks observed same-origin navigation candidates. |
| `LINKS` | Implemented (default) | Inventories links; reachability failures come from the dedicated link health checker. |
| `FORMS` | Implemented (default) | Inventories forms deterministically; visible forms can be sent to AI for safe action planning. |
| `FORM_VALIDATION` | Implemented (default) | Checks visible validation attributes; deeper cases depend on AI-planned safe actions. |
| `AUTHENTICATION` | Implemented (default) | Attempts configured login and records skipped, passed, failed, or human-required diagnostics. |
| `API_NETWORK` | Implemented (default) | Reports observed API-like calls and failed requests during page load/workflows. |
| `ERROR_HANDLING` | Implemented (default) | Reports visible error/validation states and collected runtime errors. |
| `PERFORMANCE_BASIC` | Implemented (default) | Collects basic browser timing observations; this is not load testing. |
| `CONSOLE_ERRORS` | Implemented (default) | Reports browser console errors and warnings observed during the run. |
| `ACCESSIBILITY_TECHNICAL` | Implemented (default) | Checks basic technical accessibility signals such as names on interactive controls. |
| `PASSIVE_SECURITY` | Implemented (opt-in) | Passive checks such as HTTPS observation; no exploitative testing. Implemented but unchecked by default. |
| `SESSION` | Partial | Records authenticated prerequisite state; deeper session behavior depends on observed workflows. |
| `AUTHORIZATION` | Partial | Requires two or more role credential sets and compares crawled role results; single-role runs are skipped. |
| `CHROMIUM_COMPATIBILITY` | Partial | Runs in Playwright-controlled Chrome only; no cross-browser matrix. |
| `POSITIVE` | Planned | Page is inspected; deeper happy-path workflow proof is not implemented. |
| `NEGATIVE` | Planned | Page is inspected; invalid-input workflows are not implemented. |
| `BOUNDARY` | Planned | Page is inspected; field-boundary workflows are not implemented. |
| `END_TO_END` | Planned | No deterministic end-to-end workflow engine yet. |
| `BUSINESS_RULES` | Planned | Observable rule checks are not implemented. |
| `FILE_UPLOAD_SAFE` | Planned | Safe fixture upload is represented in types but not proven by deterministic coverage. |
| `DATA_INTEGRITY_OBSERVABLE` | Planned | Requires safe create/update/readback workflows. |
| `RELIABILITY_BASIC` | Planned | Repeatability checks are not deterministic yet. |
| `REGRESSION_BASELINE` | Planned | Skipped unless a future baseline is supplied. |

Selecting a partial or planned type is allowed and never fails the request. It produces a `coverageLimitations` row with `executed: false` explaining what was and was not proven.

## Statuses

The report separates *what happened to the run* from *what the run concluded about the target*.

| Field | Values | Meaning |
| --- | --- | --- |
| `runStatus` | `COMPLETED`, `STOPPED`, `ERRORED` | Whether the run finished on its own, was stopped, or failed. |
| `findingsStatus` | `PASSED`, `ISSUES_FOUND`, `INCONCLUSIVE` | What the run concluded about the target. |
| `status` | `PASSED`, `FAILED`, `PARTIAL`, `ERROR`, `INCONCLUSIVE` | **Deprecated.** Derived alias retained for existing consumers. |

`INCONCLUSIVE` means no outcome was observable — it is recorded with a reason and never counted as passed.

### Deprecated `status` Alias

`status` is derived from the two fields above and introduces no value outside the five legacy strings:

| `runStatus` | `findingsStatus` | `status` |
| --- | --- | --- |
| `COMPLETED` | `PASSED` | `PASSED` |
| `COMPLETED` | `ISSUES_FOUND` | `FAILED` |
| `COMPLETED` | `INCONCLUSIVE` | `INCONCLUSIVE` |
| `STOPPED` | any | `PARTIAL` |
| `ERRORED` | any | `ERROR` |

New consumers should read `runStatus` and `findingsStatus` and ignore `status`.

## Coverage Limitations

`coverageLimitations` carries exactly one row per selected test type — including selected types that could not execute — so a consumer can always account for every type it asked for:

| Field | Type | Meaning |
| --- | --- | --- |
| `testType` | test type | The selected type this row accounts for. |
| `availability` | `implemented`, `partial`, `planned` | Implementation tier at run time. |
| `executed` | boolean | Whether the type actually ran. |
| `reason` | string | What was and was not proven. |

## Request And Response Example

Real sync request used against a local fixture page with AI disabled:

```json
{
  "targetUrl": "http://127.0.0.1:43117/",
  "authorizationConfirmed": true,
  "testTypes": [
    "SMOKE",
    "PAGE_DISCOVERY",
    "LINKS",
    "FORMS",
    "FORM_VALIDATION",
    "CONSOLE_ERRORS",
    "PERFORMANCE_BASIC",
    "PASSIVE_SECURITY",
    "ACCESSIBILITY_TECHNICAL"
  ],
  "browserMode": "headless",
  "visualizationMode": "off",
  "crawl": {
    "strategy": "DFS",
    "maxDepth": 1,
    "maxPages": 2,
    "sameOriginOnly": true
  },
  "execution": {
    "safeMode": true,
    "maximumRunDurationSeconds": 60,
    "allowFileUploads": false
  }
}
```

Trimmed response excerpt from the completed run:

```json
{
  "runId": "67d1530f-af2d-4387-a91a-d01dc348c1ee",
  "runStatus": "COMPLETED",
  "findingsStatus": "ISSUES_FOUND",
  "status": "FAILED",
  "stoppedReason": "converged",
  "targetOrigin": "http://127.0.0.1:43117",
  "selectedTestingTypes": ["SMOKE", "PAGE_DISCOVERY", "LINKS", "FORMS", "FORM_VALIDATION", "CONSOLE_ERRORS", "PERFORMANCE_BASIC", "PASSIVE_SECURITY", "ACCESSIBILITY_TECHNICAL"],
  "summary": {
    "pagesDiscovered": 2,
    "pagesTested": 2,
    "pagesSkipped": 0,
    "testsExecuted": 22,
    "passedTests": 14,
    "failedTests": 2,
    "skippedTests": 4,
    "blockedByPolicy": 0,
    "inconclusiveTests": 2,
    "consoleErrors": 0,
    "failedNetworkRequests": 0,
    "artifactsBytes": 184320
  }
}
```

The actual response also includes full `pages`, `issues`, `coverageLimitations`, per-page `artifacts`, and `diagnostics`. Per-page report JSON is written under `artifacts/<runId>/reports/*.json`; a completed local fixture run produced `artifacts/67d1530f-af2d-4387-a91a-d01dc348c1ee/reports/67d1530f-af2d-4387-a91a-d01dc348c1ee-127.0.0.1_43117_.json`.

## WebSocket Events

The WebSocket sends JSON messages with these wrapper types:

```text
run.snapshot
run.event
run.not_found
stream.ping
```

`run.event.event.type` can currently be:

```text
ai.batch_failed
ai.batch_started
ai.skipped_budget
ai.planning_failed
ai.planning_passed
ai.planning_skipped
ai:configuration-missing
ai:disabled
ai:enabled
ai:skipped-no-forms
browser.launched
browser.recycled
form:blocked_privileged
form:discovered
form:duplicate_skipped
form:ready-for-ai
form:scanning
live-view:cursor
live-view:frame
login.failed
login.passed
login.skipped
login.started
matrix.completed
matrix.started
navigation.initial_passed
navigation.initial_started
page.navigation_passed
page.navigation_started
page.report_written
page.snapshot_collected
run.completed
run.error
run.failed
run.orchestrator_started
run.report_ready
run.started
run:paused
run:resumed
run:stopped
test_case.failed
test_case.passed
test_case.started
```

Each progress event includes `runId`, `sequence`, `type`, `status`, `timestamp`, and `message`, with optional `pageUrl`, `role`, `viewport`, `locale`, `counts`, `diagnostics`, `issue`, `liveFrame`, `liveCursor`, or `report`.

Reconnect with `?lastSequence=N` to replay buffered events after `N`; the lightweight ring retains about 2,000 events and terminal buffers remain for 10 minutes. The terminal order is `run.completed` → `run.report_ready` → a two-second grace period → close code `1000` (`run_complete`). `stream.ping` is an application heartbeat every 30 seconds and clients answer with `stream.pong`. A run is `run.not_found` only when absent from the live registry, retained terminal buffer, and disk history.

Every run atomically checkpoints `artifacts/<runId>/manifest.json` after each completed page. Startup recovers unterminated manifests as `ERRORED` / `error`, preserving completed page reports. `ARTIFACT_RETENTION_DAYS` defaults to 14; screenshots are JPEG quality 70 and artifact totals warn above 1 GB.

Two events carry a structured `diagnostics` payload worth naming:

| Event | `diagnostics` payload | Meaning |
| --- | --- | --- |
| `form:blocked_privileged` | `{ formId, decision: "blocked_privileged", matchedSignal }` | The privileged-form classifier (§4) refused the form. A `hard` block is never planned or submitted; a `soft` block is filled but never submitted. `matchedSignal` names the rule that fired, e.g. `submit_label:invite`. |
| `form:duplicate_skipped` | `{ formId, decision: "duplicate_of:<firstPageUrl>" }` | §7 dedup: this form was already tested on an earlier page. One form is tested once, on the first page it appears. |

`live-view:cursor` carries `{ x, y, action }` in `event.liveCursor`, where `action` is one of `move`, `click`, or `scroll`. Cursor data is streamed only for local headed dev runs, is excluded from manifests and persisted reports, and the live registry retains only the latest cursor so high-frequency cursor traffic cannot evict diagnostic replay events.

## Stop States

`stoppedReason` explains why a run ended. It appears in the final report, the asynchronous run snapshot, and the `run.completed` payload.

| Value | Meaning |
| --- | --- |
| `converged` | The crawl ran out of new work within budget — the normal healthy ending. |
| `page_budget` | The configured page limit was reached. |
| `depth_budget` | The configured crawl depth limit was reached. |
| `time_budget` | The configured run duration was reached. |
| `user_stopped` | A stop was requested through `/runs/:runId/stop`. |
| `error` | The run terminated on an error, or an unterminated run manifest was recovered. |

There is deliberately **no** `ai_budget` value: an exhausted AI budget never stops a crawl. Excess AI test cases are reported as `truncated_by_budget` while deterministic checks continue.

Related run-lifecycle values:

| Surface | Value | Meaning |
| --- | --- | --- |
| `AsyncRunStatus` | `stopping` | A stop was requested and the orchestrator is unwinding at a control checkpoint. |
| `AsyncRunStatus` | `stopped` | The run completed after a stop request. |
| `RunProgressEvent.type` | `run:stopped` | Emitted immediately when `/runs/:runId/stop` is accepted. |
| `RunProgressEvent.type` | `run.completed` | Emitted after stopped run aggregation finishes, carrying `stoppedReason`. |
| Crawl diagnostic message | `Run was stopped by request.` | Recorded when the crawler exits because the async control flag is stopped. |

## AI Test Planning

Only a `FormSnapshot` — route family and visible field metadata, never a selector, value, hidden field, or full URL — crosses to the model (`src/types/llm-contract.ts`, DESIGN-DECISIONS.md §3). Forms are batched at 3 per request (or ~4k estimated input tokens, whichever hits first) and sent sequentially, one request in flight. Each batch runs the retry ladder `normal → repair prompt → next pinned model → deterministic generator`; a `FormTestCase` response is validated `.strict()` against the batch it was produced from, so an unknown key or an `elementId`/`formId` outside that batch is `llm_schema_invalid`, not silently stripped.

Validated cases are saved to `reports/planned-test-cases-*.json` before browser interaction, exposed in `pages[].plannedTestCases`, and executed one by one. The page is reloaded between cases so a submit, save, or send cannot contaminate the next case.

`MAX_AI_CALLS_PER_RUN` (default 25) caps OpenRouter requests for the run; `MAX_AI_TEST_CASES_PER_RUN` (default 400) separately caps the total planned cases, AI-generated or deterministic-fallback alike. Exhausting either never stops the run — deterministic `FORMS`/`FORM_VALIDATION` checks always complete. Case-budget overflow is reported as `truncated_by_budget` in `coverageLimitations`; call-budget exhaustion gets its own distinct wording. `diagnostics.ai` also tracks `testCasesGenerated`, `testCasesDropped`, and `deterministicFallbacks` for exact accounting.

## Source Tree

Current `src` tree:

```text
src/actions/action-policy-engine.ts
src/actions/playwright-action-executor.ts
src/ai/ai-test-planner.ts
src/ai/form-batcher.ts
src/ai/form-plan-validator.ts
src/ai/form-snapshot-builder.ts
src/ai/openrouter-client.ts
src/ai/prompt-loader.ts
src/app.ts
src/artifacts/artifact-manager.ts
src/assertions/assertion-engine.ts
src/assertions/outcome-evaluator.ts
src/authentication/authentication-handler.ts
src/authentication/login-detector.ts
src/browser/browser-manager.ts
src/browser/browser-visual-agent.ts
src/collectors/console-collector.ts
src/collectors/evidence-collector.ts
src/collectors/network-collector.ts
src/collectors/performance-collector.ts
src/config/env.ts
src/config/logger.ts
src/controllers/testing.controller.ts
src/crawler/page-crawler.ts
src/crawler/scope-policy.ts
src/crawler/state-fingerprint-service.ts
src/crawler/url-canonicalizer.ts
src/docs/openapi.ts
src/docs/swagger.ts
src/errors/app-error.ts
src/errors/error-codes.ts
src/errors/serialize-error.ts
src/inspection/element-inventory.ts
src/inspection/page-inspector.ts
src/middleware/error.middleware.ts
src/middleware/request-id.middleware.ts
src/prompts/form-test-planner.system.md
src/reporting/report-aggregator.ts
src/reporting/severity.ts
src/routes/testing.routes.ts
src/runs/run-events.ts
src/runs/run-registry.ts
src/safety/form-classifier.ts
src/schemas/llm-contract.schema.ts
src/schemas/report.schema.ts
src/schemas/testing-request.schema.ts
src/security/secret-redaction.ts
src/security/ssrf-protection.ts
src/server.ts
src/services/run-orchestrator.ts
src/testing/deterministic-form-plan.ts
src/testing/form-data-generator.ts
src/testing/form-dedup.ts
src/testing/form-test-executor.ts
src/testing/link-health-checker.ts
src/testing/page-baseline-tests.ts
src/testing/run-context.ts
src/testing/run-matrix.ts
src/testing/test-types.ts
src/types/ai.ts
src/types/llm-contract.ts
src/types/report.ts
src/types/testing.ts
src/utilities/async-handler.ts
src/utilities/route-family.ts
src/utilities/timeout.ts
src/websocket/testing-run-stream.ts
```

See [package.json](package.json) for the exact scripts and dependency versions.

## Setup

```bash
npm install
# create .env and add the values shown below
npm run playwright:install:chrome
npm run dev
```

Then open:

```text
http://localhost:3000/docs
```

Add your OpenRouter configuration manually in `.env`:

```env
OPENROUTER_API_KEY=your_secret_here
OPENROUTER_API_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_TIMEOUT_MS=300000
```

OpenRouter AI planning sends the canonical prompt as a system message and sanitized `{ formCount, forms }` input as a user message. It requests strict JSON-schema output and validates every returned ID against the discovered form before saving or executing it. If `OPENROUTER_API_KEY` is missing, deterministic planning remains active.

Do not commit `.env`.

## Environment Variables

Important values:

```env
OPENROUTER_API_KEY=
OPENROUTER_API_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_TIMEOUT_MS=300000
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_CHANNEL=chrome
AI_CALL_PACING_MS=1500
ACTION_TIMEOUT_MS=10000
NAVIGATION_TIMEOUT_MS=30000
TEST_RUN_ALLOWED_ORIGINS=
FRONTEND_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:5173
SCREENSHOT_DIRECTORY=artifacts/screenshots
TRACE_DIRECTORY=artifacts/traces
LIVE_VIEW_ENABLED=true
LIVE_VIEW_FRAME_INTERVAL_MS=1500
```

Legacy `BROWSER_*` and `PAGE_NAVIGATION_TIMEOUT_MS` variables still work.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
npm run openrouter:smoke
npm run trueform:system-test
npm run playwright:install:chrome
```
