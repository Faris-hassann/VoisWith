# TesterBackend API and WebSocket Reference

This document explains the complete public interface in simple terms. The runtime OpenAPI 3.1 source is `src/docs/openapi.ts` and is served as JSON at `/openapi.json`. Swagger UI is served at `/docs`.

> Only test a target that you own or are authorized to test. `authorizationConfirmed: true` is required for every run. Enabling form submission also requires `writeActionsAcknowledged: true`.

## Connection details

| Item | Value |
| --- | --- |
| Default HTTP base URL | `http://localhost:3000` |
| REST prefix | `/api/v1/testing` |
| Request/response format | JSON, except the report download |
| WebSocket path | `/api/v1/testing/runs/{runId}/stream` |
| Interactive documentation | `GET /docs` |
| OpenAPI document | `GET /openapi.json` |
| Health check | `GET /health` |

All HTTP responses receive `X-Request-Id`. A valid incoming `X-Request-Id` is reused; otherwise the server creates a UUID. Error responses include this ID for log correlation. JSON request bodies are limited to 512 KB, and HTTP calls are rate-limited to 30 per minute per client.

## Endpoint summary

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | 200 | Liveness check. |
| `GET` | `/docs` | 200 | Swagger UI. |
| `GET` | `/openapi.json` | 200 | OpenAPI 3.1 JSON. |
| `POST` | `/api/v1/testing/run` | 200 | Run synchronously and return the final report. |
| `POST` | `/api/v1/testing/runs` | 202 | Start asynchronously and return immediately. |
| `GET` | `/api/v1/testing/runs` | 200 | List retained completed runs, newest first. |
| `GET` | `/api/v1/testing/runs/{runId}` | 200 | Read live or persisted run state. |
| `POST` | `/api/v1/testing/runs/{runId}/pause` | 200 | Pause at orchestration control points. |
| `POST` | `/api/v1/testing/runs/{runId}/resume` | 200 | Resume a paused run. |
| `POST` | `/api/v1/testing/runs/{runId}/stop` | 200 | Request a graceful stop. |
| `GET` | `/api/v1/testing/runs/{runId}/report.json` | 200 | Download the completed JSON report. |
| `WS` | `/api/v1/testing/runs/{runId}/stream` | 101 | Receive snapshot and live events. |

The checked-in OpenAPI document currently describes health, synchronous start, async start/list, and async status. The pause, resume, stop, report-download, and WebSocket surfaces are implemented runtime APIs and are documented here even though they are not yet represented as OpenAPI paths.

## Authentication

The backend API itself does not implement an API-key or bearer-token authentication scheme. Deployment infrastructure should protect it before exposing it beyond a trusted network. Target-site credentials can be carried inside a run request; they authenticate the Playwright browser to the target, not the caller to TesterBackend.

## Run request

Both POST endpoints accept the same object.

### Top-level fields

| Field | Type | Required/default | Rules and meaning |
| --- | --- | --- | --- |
| `targetUrl` | URL string | **Required** | Initial page. The URL and resolved address must pass security policy. |
| `authorizationConfirmed` | boolean | **Required: `true`** | Explicit permission confirmation. |
| `writeActionsAcknowledged` | boolean | Optional | Must be `true` when form submission is enabled. |
| `environment` | `production` or `staging` | `production` | Describes the target environment. It does not bypass policy. |
| `credentials` | Credentials | Optional | One default login identity. `enabled:false` removes it. |
| `roles` | RoleCredential[] | Optional, 1–3 | Named `Admin`, `Agent`, or `Client` identities for role matrix runs. |
| `testTypes` | TestType[] | Required, 1–25 | Canonical selected capabilities. If omitted by the compatibility preprocessor, `SMOKE` is supplied. |
| `selectedTestTypes` | string[] | Optional, legacy | Friendly aliases are normalized; recognized values override `testTypes`. Unknown entries are dropped. |
| `allowedOrigins` | URL[] | target origin | Maximum 50; normalized to origins. |
| `includeSubdomains` | boolean | `false` | Permit subdomains of configured allowed origins. |
| `browserMode` | `headed` or `headless` | derived | Modern browser visibility field; overrides `browser.headless`. |
| `visualizationMode` | `local`, `live`, or `off` | `local` | Select local visualization, streamed visualization, or none. |
| `testData` | object | `{}` | Caller-supplied non-schema-specific test data. |
| `crawl` | CrawlSettings | defaults below | DFS scope and budgets. |
| `browser` | BrowserSettings | defaults below | Chrome and viewport configuration. |
| `execution` | ExecutionSettings | defaults below | Safety and run budgets. |
| `testMatrix` | TestMatrixSettings | disabled | Viewport and locale combinations. |

The runtime top-level schema is intentionally forward-compatible (`passthrough`), although the current OpenAPI component says `additionalProperties:false`. Nested configuration objects are strict and reject unknown keys.

### Credentials

| Field | Type | Required/default | Limits |
| --- | --- | --- | --- |
| `enabled` | boolean | enabled when present | `false` disables this credentials object. |
| `loginUrl` | URL string | Optional | Explicit login page. |
| `username` | string | Required when enabled | 1–500 characters. |
| `password` | string | Required when enabled | 1–2000 characters. |
| `fieldHints.usernameSelector` | string | Optional | 1–500 character selector hint. |
| `fieldHints.passwordSelector` | string | Optional | 1–500 character selector hint. |
| `fieldHints.submitSelector` | string | Optional | 1–500 character selector hint. |

A role has `name`, `credentials`, and optional role-level `loginUrl` and `fieldHints`. Credentials and selectors are redacted from logs and persisted results.

### CrawlSettings

| Field | Type | Default | Limits/behavior |
| --- | --- | --- | --- |
| `strategy` | `DFS` | `DFS` | Only depth-first search is supported. |
| `maxDepth` | integer | server maximum (7) | 0–7. |
| `maxPages` | integer | server maximum (500) | 1–500. |
| `sameOriginOnly` | boolean | `true` | Remains true unless explicit allowed origins are supplied. |
| `includePatterns` | string[] | `[]` | Up to 100 patterns, each 1–300 characters. |
| `excludePatterns` | string[] | logout/delete/remove/payment | Same limits; protects risky routes by default. |
| `ignoredQueryParameters` | string[] | common `utm_*`, `fbclid`, `gclid` | Removed during route/canonical URL grouping. |

Patterns are applied by the crawler's scope policy. A URL can be discovered but skipped or left unreached when it is out of scope or a budget ends the run.

### BrowserSettings

| Field | Type | Default | Limits |
| --- | --- | --- | --- |
| `channel` | `chrome` | `chrome` | No other browser channel is accepted. |
| `headless` | boolean | `false` | Can be overridden by top-level `browserMode`. |
| `viewport.width` | integer | `1440` | 320–3840. |
| `viewport.height` | integer | `900` | 240–2160. |

### ExecutionSettings

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `safeMode` | boolean | `true` | Enables conservative action policy. |
| `allowFormSubmission` | boolean | `false` | Permits eligible submit actions; also requires acknowledgment. |
| `allowFileUploads` | boolean | compatibility default `false` | Permits safe upload actions when implemented and eligible. The base schema default is `true`, but request preprocessing supplies `false` when omitted. |
| `allowDestructiveActions` | boolean | `false` | Requests destructive actions, still subject to classifier/policy. |
| `allowPayments` | boolean | `false` | Requests payment actions, still subject to classifier/policy. |
| `maximumActionsPerPage` | integer | `15` | 1–200 and bounded by server policy. |
| `maximumRunDurationSeconds` | integer | `10800` | 10–10800 and bounded by server policy. |

### TestMatrixSettings

| Field | Type | Default | Limits |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Enables supplied viewport/locale expansion. |
| `viewports` | object[] | `[]` | At most 10. Each needs a 1–50 character name, width 320–3840, height 240–2160. |
| `locales` | object[] | `[]` | At most 5. Each needs a 1–50 character name, 2–20 character locale, and `ltr`/`rtl` direction. |

Roles, viewports, and locales form the execution matrix. With no matrix values, the base browser viewport and normal locale are used.

### TestType values

```text
SMOKE, PAGE_DISCOVERY, NAVIGATION, LINKS, FORMS, FORM_VALIDATION,
POSITIVE, NEGATIVE, BOUNDARY, AUTHENTICATION, SESSION, AUTHORIZATION,
END_TO_END, BUSINESS_RULES, API_NETWORK, ERROR_HANDLING, FILE_UPLOAD_SAFE,
DATA_INTEGRITY_OBSERVABLE, PERFORMANCE_BASIC, RELIABILITY_BASIC,
CHROMIUM_COMPATIBILITY, PASSIVE_SECURITY, REGRESSION_BASELINE,
CONSOLE_ERRORS, ACCESSIBILITY_TECHNICAL
```

Legacy `selectedTestTypes` aliases include `smoke`, `navigation`, `links`, `forms`, `validation`, `functional`, `authentication`, `authorization`, `accessibility`, `responsive`, `error-handling`, `ui`, `session`, `end-to-end`, and `regression`. Prefer canonical `testTypes` in new clients.

### Safe request example

```json
{
  "targetUrl": "https://example.com",
  "authorizationConfirmed": true,
  "environment": "staging",
  "testTypes": ["SMOKE", "PAGE_DISCOVERY", "LINKS", "CONSOLE_ERRORS"],
  "browserMode": "headless",
  "visualizationMode": "off",
  "crawl": {
    "strategy": "DFS",
    "maxDepth": 1,
    "maxPages": 5,
    "sameOriginOnly": true,
    "includePatterns": [],
    "excludePatterns": ["/logout", "/delete", "/remove", "/payment"]
  },
  "execution": {
    "safeMode": true,
    "allowFormSubmission": false,
    "allowFileUploads": false,
    "allowDestructiveActions": false,
    "allowPayments": false,
    "maximumActionsPerPage": 15,
    "maximumRunDurationSeconds": 300
  }
}
```

## Endpoint details

### `GET /health`

Returns 200:

```json
{ "status": "ok" }
```

It confirms that Express is responding. It does not launch Chrome, call the AI provider, or test a target.

### `POST /api/v1/testing/run`

Validates the request, executes the entire run in the HTTP call, and returns a `TestingRunResponse` with status 200. Use it only when the caller and proxy can tolerate the full runtime. Possible documented errors are 400, 429, and 500.

### `POST /api/v1/testing/runs`

Starts the same pipeline in the async registry. Returns 202:

```json
{
  "runId": "7c45112f-3de4-4aa2-9bb8-106c481df7dd",
  "status": "running",
  "startedAt": "2026-08-17T12:00:00.000Z",
  "streamUrl": "/api/v1/testing/runs/7c45112f-3de4-4aa2-9bb8-106c481df7dd/stream"
}
```

`status` is an async lifecycle value: `queued`, `running`, `paused`, `stopping`, `stopped`, `completed`, or `failed`. The current registry creates accepted runs directly as `running`, but clients should accept the full enum.

### `GET /api/v1/testing/runs`

Returns retained terminal runs newest-first:

```json
{
  "runs": [
    {
      "runId": "7c45112f-3de4-4aa2-9bb8-106c481df7dd",
      "targetOrigin": "https://example.com",
      "runStatus": "COMPLETED",
      "findingsStatus": "PASSED",
      "status": "PASSED",
      "stoppedReason": "converged",
      "startedAt": "2026-08-17T12:00:00.000Z",
      "completedAt": "2026-08-17T12:00:12.000Z",
      "summary": {},
      "issueCount": 0,
      "artifactsBytes": 12345
    }
  ]
}
```

The real `summary` contains all counters described below. Active runs are held by the registry and are not part of this disk-backed terminal history list.

### `GET /api/v1/testing/runs/{runId}`

Returns the live registry snapshot, or a persisted terminal snapshot after restart/registry cleanup:

```json
{
  "runId": "7c45112f-3de4-4aa2-9bb8-106c481df7dd",
  "status": "running",
  "startedAt": "2026-08-17T12:00:00.000Z",
  "updatedAt": "2026-08-17T12:00:03.000Z",
  "events": [],
  "formTestCases": [],
  "report": null,
  "error": null
}
```

Optional properties may be absent rather than `null`. Persisted snapshots contain an empty event list and the final report. Returns 400 for a missing ID and 404 `RUN_NOT_FOUND` for an unknown ID.

### Pause, resume, and stop

```text
POST /api/v1/testing/runs/{runId}/pause
POST /api/v1/testing/runs/{runId}/resume
POST /api/v1/testing/runs/{runId}/stop
```

Each returns the updated `AsyncRunSnapshot` with status 200. Pause changes a running record to `paused` and emits `run:paused`. Resume changes a paused record to `running` and emits `run:resumed`. Stop changes any non-terminal record to `stopping`, releases a paused waiter, and emits `run:stopped`; the orchestrator then finishes current cleanup/checkpoint work and aggregates a stopped report.

Calling pause/resume in a state where it does not apply is idempotent and returns the current snapshot. Lifecycle mutation operates on live registry entries, not old persisted runs. Unknown IDs return 404.

### `GET /api/v1/testing/runs/{runId}/report.json`

Returns the formatted final report with:

```text
Content-Type: application/json
Content-Disposition: attachment; filename="testing-report-{runId}.json"
```

An unknown run returns 404 `RUN_NOT_FOUND`. A known run without a report returns 404 `REPORT_NOT_READY`.

## Final report contract

### TestingRunResponse

| Field | Type | Meaning |
| --- | --- | --- |
| `runId` | string | UUID identifying this run. |
| `runStatus` | enum | `COMPLETED`, `STOPPED`, or `ERRORED`. |
| `findingsStatus` | enum | `PASSED`, `ISSUES_FOUND`, or `INCONCLUSIVE`. |
| `status` | enum | Deprecated compatibility value. |
| `startedAt`, `completedAt` | ISO date-time | Run time range. |
| `targetOrigin` | string | Normalized origin, without target path/query. |
| `selectedTestingTypes` | TestType[] | Canonical types actually requested. |
| `stoppedReason` | enum, optional | `converged`, `page_budget`, `depth_budget`, `time_budget`, `user_stopped`, or `error`. |
| `summary` | RunSummary | Aggregate counters. |
| `pages` | PageReport[] | Per page/matrix-target evidence and test results. |
| `issues` | Issue[] | Fingerprinted and aggregated findings. |
| `coverageLimitations` | CoverageLimitation[] | Exactly one row per selected type. |
| `artifacts` | EvidenceReference[] | Run-level evidence. |
| `diagnostics` | RunDiagnostics, optional | Detailed execution/accounting information. |

The deprecated mapping is: completed + passed → `PASSED`; completed + issues → `FAILED`; completed + inconclusive → `INCONCLUSIVE`; stopped → `PARTIAL`; errored → `ERROR`.

### RunSummary

Every counter is a non-negative integer:

- `pagesDiscovered`, `pagesTested`, `pagesSkipped`, `pagesNotReached`.
- `testsExecuted`, `passedTests`, `failedTests`, `skippedTests`, `blockedByPolicy`, `inconclusiveTests`.
- `consoleErrors`, `failedNetworkRequests`, and `artifactsBytes`.

`pagesNotReached` counts queued URLs that were never visited because a budget or stop ended crawling. Planned test cases are not counted as executed until execution produces results.

### PageReport

A page report contains `url`, `canonicalUrl`, optional `stateFingerprint`, matrix labels (`role`, `viewport`, `locale`, `direction`), overall test `status`, `tests`, `consoleErrors`, `failedNetworkRequests`, `performanceObservations`, `evidence`, optional `skippedReason`, optional `plannedTestCases`, and planning source (`ai`, `deterministic`, or `mixed`).

Test status values are `PASSED`, `FAILED`, `SKIPPED`, `BLOCKED_BY_POLICY`, `INCONCLUSIVE`, and `ERROR`. Each test contains an ID/name/type/status, priority, steps, assertions, expected/actual results, error, evidence, reproduction steps, severity, and confidence when applicable. A step records its action and observable result.

Network observations include URL, method, resource type, status, duration, failure reason, same-origin flag, API-like flag, and a deduplication key. Console observations contain type/text/location. Performance observations contain a name, optional milliseconds, and description.

### Issue

| Field | Meaning |
| --- | --- |
| `id`, `fingerprint` | Finding identity and stable grouping key. |
| `severity` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or `INFORMATIONAL`. |
| `title`, `description` | Human-readable finding. |
| `occurrenceCount`, `failedTestCount` | Aggregation counts. |
| `affectedPages`, `relatedTestTypes` | Scope of the grouped issue. |
| `pageUrl`, `role`, `viewport`, `locale`, `testName` | Representative context. |
| `evidence` | Related artifact references. |
| `confidence` | Numeric confidence. |

### CoverageLimitation and EvidenceReference

A coverage row has `testType`, `availability` (`implemented`, `partial`, `planned`), `executed`, and `reason`. This prevents a selected but unavailable test type from being mistaken for a pass.

Evidence has `id`, `type`, `path`, optional `description`, and optional `sizeBytes`. Types are `screenshot`, `trace`, `network`, `console`, `report`, `download`, and `fixture`. Paths identify server-side artifact files; the current API has no general artifact-download endpoint other than the final JSON report.

## Errors

Standard error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "requestId": "8094ddd9-dd4e-4244-80ab-09521f700001",
    "details": []
  }
}
```

`details` is optional. Zod validation errors use HTTP 400 and include issue paths/messages. An `AppError` supplies its own status and code. Unknown exceptions return HTTP 500 with code `INTERNAL_ERROR`; production hides the internal message. Unsafe target/scope, provider, browser, navigation, policy, and timeout failures use the service's named error codes:

```text
VALIDATION_ERROR, AUTHORIZATION_REQUIRED, WRITE_ACTION_ACK_REQUIRED,
TARGET_URL_UNSAFE, TARGET_ORIGIN_NOT_ALLOWED, PRIVATE_NETWORK_TARGET_BLOCKED,
HTTPS_REQUIRED, DNS_RESOLUTION_FAILED, BROWSER_LAUNCH_FAILED,
NAVIGATION_FAILED, LOGIN_FAILED, LOGIN_HUMAN_REQUIRED, AI_CONFIGURATION_MISSING,
AI_REQUEST_FAILED, AI_RESPONSE_INVALID, AI_RESPONSE_TIMEOUT,
AI_RATE_LIMITED, AI_CONTEXT_TOO_LARGE, ACTION_BLOCKED_BY_POLICY,
TEST_RUN_TIMEOUT, INTERNAL_ERROR
```

Controller-specific codes also include `RUN_ID_REQUIRED`, `RUN_NOT_FOUND`, and `REPORT_NOT_READY`. CORS rejection occurs before route handling for disallowed browser origins. Rate/concurrency overload uses HTTP 429.

## WebSocket stream

Connect after async start:

```text
ws://localhost:3000/api/v1/testing/runs/{runId}/stream
```

For browser clients, `Origin` must match `FRONTEND_ORIGINS` or built-in localhost origins `http://localhost:3000`, `http://localhost:3001`, or `http://localhost:5173`. Non-browser clients without an Origin header are accepted. The run ID is URL-decoded.

### Reconnect and replay

```text
ws://localhost:3000/api/v1/testing/runs/{runId}/stream?lastSequence=42
```

`lastSequence` must be a non-negative safe integer. The initial `run.snapshot` contains buffered events strictly after it. Live diagnostic events retain about 2,000 entries. Latest frame and latest cursor are retained separately. A disk-only terminal run returns its persisted snapshot but has no historical in-memory event replay.

### Server wrapper messages

Initial snapshot:

```json
{ "type": "run.snapshot", "snapshot": { "runId": "...", "status": "running", "events": [] } }
```

Live event:

```json
{ "type": "run.event", "event": { "runId": "...", "sequence": 3, "type": "browser.launched", "status": "passed", "timestamp": "...", "message": "..." } }
```

Unknown run:

```json
{ "type": "run.not_found", "runId": "...", "message": "Run not found." }
```

Heartbeat:

```json
{ "type": "stream.ping", "timestamp": "2026-08-17T12:00:30.000Z" }
```

Client response:

```json
{ "type": "stream.pong" }
```

The server also sends protocol-level ping frames. If two application heartbeat intervals pass without a JSON pong, it closes with code `4000`, reason `heartbeat_timeout`. Unknown or invalid client JSON is ignored.

### RunProgressEvent

Required fields: `runId`, monotonically increasing `sequence`, `type`, `status`, ISO `timestamp`, and `message`. Status is `started`, `passed`, `failed`, `skipped`, `info`, or `blocked`.

Optional fields are `pageUrl`, `role`, `viewport`, `locale`, numeric `counts`, arbitrary `diagnostics`, `issue`, `stoppedReason`, full terminal `report`, and `formTestCase`. Visual payloads are:

```json
{ "liveFrame": { "mimeType": "image/jpeg", "data": "<base64>", "pageUrl": "https://..." } }
```

```json
{ "liveCursor": { "x": 100, "y": 240, "action": "move" } }
```

Cursor action is `move`, `click`, or `scroll`. Cursor streaming is limited to suitable local headed development runs and is not persisted.

### Event types

Current runtime events include:

```text
ai.batch_failed                 ai.batch_started
ai.skipped_budget               ai.planning_failed
ai.planning_passed              ai.planning_skipped
ai:configuration-missing        ai:disabled
ai:enabled                      ai:skipped-no-forms
browser.launched                browser.recycled
form:blocked_privileged         form:discovered
form:duplicate_skipped          form:ready-for-ai
form:scanning                   live-view:cursor
live-view:frame                 login.failed
login.passed                    login.skipped
login.started                   matrix.completed
matrix.started                  navigation.initial_passed
navigation.initial_started      page.navigation_passed
page.navigation_started         page.report_written
page.snapshot_collected         run.completed
run.error                       run.failed
run.orchestrator_started        run.report_ready
run.started                     run:paused
run:resumed                     run:stopped
test_case.failed                test_case.passed
test_case.started
```

The event type is intentionally a string, so clients must ignore unknown future types. `form:blocked_privileged` diagnostics identify the form, decision, and matched signal. `form:duplicate_skipped` identifies the first page that owned the duplicate. Test-case state can be `planned`, `running`, `holding`, `submitting`, `passed`, `failed`, or `inconclusive` and includes the selected button and hold countdown when relevant.

### Terminal behavior

Normal completion emits `run.completed` with the final report, then `run.report_ready`. The socket remains open for a two-second grace period and closes with code `1000`, reason `run_complete`. A stopped run follows the same aggregation path with stopped statuses. An unhandled async failure emits `run.failed`. Unknown runs close with code `1008`, reason `Run not found`.

## Client workflow recommendation

1. POST `/runs` and store `runId` and `streamUrl`.
2. Open the WebSocket and process the first `run.snapshot`.
3. Store the largest processed `event.sequence`.
4. Answer every `stream.ping` with `stream.pong`.
5. On disconnect, reconnect using `lastSequence`.
6. Treat new event names as informational, not fatal.
7. Wait for `run.report_ready` or poll GET `/runs/{runId}`.
8. Read `runStatus` and `findingsStatus`; do not base new logic on deprecated `status`.
9. Account for every selected type through `coverageLimitations`.
10. Download `/report.json` when a portable formatted result is needed.

## cURL examples

```bash
# Start
curl -sS -X POST http://localhost:3000/api/v1/testing/runs \
  -H 'content-type: application/json' \
  -d '{"targetUrl":"https://example.com","authorizationConfirmed":true,"testTypes":["SMOKE"]}'

# Read status
curl -sS http://localhost:3000/api/v1/testing/runs/REPLACE_RUN_ID

# Pause and resume
curl -sS -X POST http://localhost:3000/api/v1/testing/runs/REPLACE_RUN_ID/pause
curl -sS -X POST http://localhost:3000/api/v1/testing/runs/REPLACE_RUN_ID/resume

# Stop
curl -sS -X POST http://localhost:3000/api/v1/testing/runs/REPLACE_RUN_ID/stop

# Download final report
curl -fLo report.json http://localhost:3000/api/v1/testing/runs/REPLACE_RUN_ID/report.json
```

These examples assume the default port and an authorized target. They intentionally keep form submission disabled.
