# TesterFrontend

TesterFrontend is a Next.js App Router UI for configuring, starting, streaming, controlling, and reviewing authorized web test runs from `TesterBackend`.

Part of the [VoisWith repository overview](../README.md).

## What Runs Now

The frontend does not run Playwright and does not hold OpenRouter secrets. It builds a backend request, requires the authorization confirmation gate, calls the backend directly or through local Next.js proxy routes, and renders async run state from HTTP polling plus WebSocket events.

Routes:

```text
/                                      redirects to /testing/new
/testing/new                          configure and start a test
/testing/running/[runId]              stream events, live-view frames, DFS progress, and controls
/testing/results/[runId]              show the completed backend report
/testing/history                      list retained backend run history
/settings                             show API configuration
/about                                explain safety and current limitations
/api/testing/run                      proxy sync runs when NEXT_PUBLIC_API_MODE=proxy
/api/testing/runs                     proxy async start when NEXT_PUBLIC_API_MODE=proxy
/api/testing/runs/[runId]             proxy async status when NEXT_PUBLIC_API_MODE=proxy
/api/testing/runs/[runId]/[action]    proxy pause/resume/stop when NEXT_PUBLIC_API_MODE=proxy
/api/testing/runs/[runId]/report.json proxy report download when NEXT_PUBLIC_API_MODE=proxy
```

The main production path uses `POST /api/v1/testing/runs`, then opens `WS /api/v1/testing/runs/:runId/stream`. The older sync helper for `POST /api/v1/testing/run` still exists in `src/lib/api/testing.api.ts`.

## Authorization Gate

The UI schema requires `authorizationConfirmed: true` before a run can be submitted. The backend also enforces the same literal `true` requirement, so bypassing the UI does not bypass authorization.

The effective backend target allowlist is:

- Default target allowlist: the origin of `targetUrl`.
- Optional request allowlist: `allowedOrigins`.
- Optional subdomain expansion: `includeSubdomains`.
- Backend WebSocket browser-origin allowlist: `FRONTEND_ORIGINS`, plus `http://localhost:3000`, `http://localhost:3001`, and `http://localhost:5173`.

Credentials are omitted from frontend storage, query keys, URLs, review summaries, and logs.

## Test-Type Availability

The selector exposes the backend `TEST_TYPES` list across four tiers. Only the 12 implemented-and-default types are checked when the form loads; everything else is unchecked and must be selected deliberately. Partial and planned types are labelled **"Planned - limited results"** in the selector.

| Test type | Tier | Checked by default |
| --- | --- | --- |
| `SMOKE` | Implemented | Yes |
| `PAGE_DISCOVERY` | Implemented | Yes |
| `NAVIGATION` | Implemented | Yes |
| `LINKS` | Implemented | Yes |
| `FORMS` | Implemented | Yes |
| `FORM_VALIDATION` | Implemented | Yes |
| `AUTHENTICATION` | Implemented | Yes |
| `API_NETWORK` | Implemented | Yes |
| `ERROR_HANDLING` | Implemented | Yes |
| `PERFORMANCE_BASIC` | Implemented | Yes |
| `CONSOLE_ERRORS` | Implemented | Yes |
| `ACCESSIBILITY_TECHNICAL` | Implemented | Yes |
| `PASSIVE_SECURITY` | Implemented | No |
| `SESSION` | Partial | No |
| `AUTHORIZATION` | Partial; needs two or more role credential sets | No |
| `CHROMIUM_COMPATIBILITY` | Partial; Chrome only | No |
| `POSITIVE` | Planned | No |
| `NEGATIVE` | Planned | No |
| `BOUNDARY` | Planned | No |
| `END_TO_END` | Planned | No |
| `BUSINESS_RULES` | Planned | No |
| `FILE_UPLOAD_SAFE` | Planned | No |
| `DATA_INTEGRITY_OBSERVABLE` | Planned | No |
| `RELIABILITY_BASIC` | Planned | No |
| `REGRESSION_BASELINE` | Planned | No |

Selecting a partial or planned type never fails the request. Each selected type comes back as one `coverageLimitations` row explaining what was and was not proven.

## Write Acknowledgment

The acknowledgment checkbox is shown whenever **Allow form submission** is enabled, whether or not credentials are supplied — anonymous submission can create or modify data too. When credentials *are* present, the copy is strengthened to name the privileged session explicitly.

The request carries `writeActionsAcknowledged: true` alongside `execution.allowFormSubmission: true`; the backend rejects the pair if the acknowledgment is missing.

## Statuses

The dashboard renders run outcome and findings separately.

| Field | Values | Rendered as |
| --- | --- | --- |
| `runStatus` | `COMPLETED`, `STOPPED`, `ERRORED` | Run outcome badge. |
| `findingsStatus` | `PASSED`, `ISSUES_FOUND`, `INCONCLUSIVE` | Findings badge. |
| `stoppedReason` | `converged`, `page_budget`, `depth_budget`, `time_budget`, `user_stopped`, `error` | Banner above the summary when the run did not simply converge. |
| `status` | `PASSED`, `FAILED`, `PARTIAL`, `ERROR`, `INCONCLUSIVE` | **Deprecated** alias; retained for compatibility, not rendered as the primary status. |

`INCONCLUSIVE` is rendered as its own result, distinct from both pass and fail, and is never counted as passed.

## Backend Contract Consumed By The UI

Async start:

```http
POST /api/v1/testing/runs
```

```json
{
  "runId": "uuid",
  "status": "running",
  "startedAt": "2026-08-06T12:00:00.000Z",
  "streamUrl": "/api/v1/testing/runs/uuid/stream"
}
```

Sync completed-report endpoint still supported:

```http
POST /api/v1/testing/run
```

Real request used against a local fixture page:

```json
{
  "targetUrl": "http://127.0.0.1:43117/",
  "authorizationConfirmed": true,
  "testTypes": ["SMOKE", "PAGE_DISCOVERY", "LINKS", "FORMS", "FORM_VALIDATION", "CONSOLE_ERRORS", "PERFORMANCE_BASIC", "PASSIVE_SECURITY", "ACCESSIBILITY_TECHNICAL"],
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

Completed report summary from that run:

```json
{
  "runId": "67d1530f-af2d-4387-a91a-d01dc348c1ee",
  "runStatus": "COMPLETED",
  "findingsStatus": "ISSUES_FOUND",
  "status": "FAILED",
  "stoppedReason": "converged",
  "targetOrigin": "http://127.0.0.1:43117",
  "summary": {
    "pagesDiscovered": 2,
    "pagesTested": 2,
    "testsExecuted": 22,
    "passedTests": 14,
    "failedTests": 2,
    "skippedTests": 4,
    "inconclusiveTests": 2,
    "artifactsBytes": 184320
  }
}
```

## WebSocket Events

The running page handles these WebSocket wrapper messages:

```text
run.snapshot
run.event
run.not_found
stream.ping
```

The backend currently emits these progress event types inside `run.event.event.type`:

```text
ai.skipped_budget
ai.planning_failed
ai.planning_passed
ai.planning_skipped
ai.batch_failed
ai.batch_started
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

`live-view:frame` events carry a base64 JPEG in `event.liveFrame.data`. `live-view:cursor` carries `{ x, y, action }` in `event.liveCursor`, and the frontend animates those viewport coordinates on top of the slower JPEG stream without raising the 1500 ms frame interval.

The client reconnects non-1000 closes with `?lastSequence=N` using capped exponential backoff while polling the disk-backed async endpoint every 10 seconds. It answers `stream.ping` with `stream.pong`, declares the socket dead after two missed 30-second heartbeats, and never reconnects after close code 1000. History and result routes read the backend retention store; browser local storage is only a cache.

## Stop States

`stoppedReason` explains why a run ended. It arrives on the final report, the async run snapshot, and the `run.completed` payload.

| Value | Meaning |
| --- | --- |
| `converged` | The crawl ran out of new work within budget — the normal healthy ending. |
| `page_budget` | The configured page limit was reached. |
| `depth_budget` | The configured crawl depth limit was reached. |
| `time_budget` | The configured run duration was reached. |
| `user_stopped` | The user stopped the run. |
| `error` | The run terminated on an error, or an unterminated run was recovered. |

The UI shows a stopped-reason banner for every value except `converged`. There is no `ai_budget` value: an exhausted AI budget never stops a run.

Related run-lifecycle values:

| Surface | Value | Meaning |
| --- | --- | --- |
| `AsyncRunStatus` | `stopping` | Stop was requested; backend is unwinding. |
| `AsyncRunStatus` | `stopped` | Backend completed aggregation after a stop. |
| `RunProgressEvent.type` | `run:stopped` | Stop request was accepted. |
| `RunProgressEvent.type` | `run.completed` | Final event after aggregation, carrying `stoppedReason`. |

## Source Tree

Current `src` tree:

```text
src/app/about/page.tsx
src/app/api/testing/run/route.ts
src/app/api/testing/runs/[runId]/[action]/route.ts
src/app/api/testing/runs/[runId]/report.json/route.ts
src/app/api/testing/runs/[runId]/route.ts
src/app/api/testing/runs/route.ts
src/app/globals.css
src/app/icon.svg
src/app/layout.tsx
src/app/page.tsx
src/app/settings/page.tsx
src/app/testing/history/page.test.tsx
src/app/testing/history/page.tsx
src/app/testing/new/page.tsx
src/app/testing/results/[runId]/page.tsx
src/app/testing/running/[runId]/page.tsx
src/components/layout/AppHeader.tsx
src/components/layout/AppSidebar.tsx
src/components/layout/BackendStatus.tsx
src/components/results/DiagnosticsPanel.tsx
src/components/results/RawReportViewer.tsx
src/components/results/ResultsDashboard.tsx
src/components/results/SimpleTable.tsx
src/components/results/TestStatusChart.tsx
src/components/results/TestSummaryCards.tsx
src/components/shared/ApiErrorAlert.tsx
src/components/shared/EmptyState.tsx
src/components/testing/RunningTestPanel.tsx
src/components/testing/TestConfigurationForm.tsx
src/components/testing/TestingTypesSelector.tsx
src/components/ui/button.tsx
src/components/ui/card.tsx
src/components/ui/status-badge.tsx
src/lib/api/client.ts
src/lib/api/endpoints.ts
src/lib/api/errors.ts
src/lib/api/testing.api.test.ts
src/lib/api/testing.api.ts
src/lib/api/types.ts
src/lib/environment/env.ts
src/lib/environment/public-env.ts
src/lib/schemas/testing-run.schema.test.ts
src/lib/schemas/testing-run.schema.ts
src/lib/security/redact.test.ts
src/lib/security/redact.ts
src/lib/testing/mock-reports.ts
src/lib/testing/payload.test.ts
src/lib/testing/payload.ts
src/lib/utils.ts
src/providers/app-providers.tsx
src/providers/query-provider.tsx
src/providers/report-store-provider.test.tsx
src/providers/report-store-provider.tsx
src/providers/theme-provider.tsx
src/test/setup.ts
```

See [package.json](package.json) for the exact scripts and dependency versions.

## Environment

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_API_DOCS_URL=http://localhost:3000/docs/
NEXT_PUBLIC_TEST_RUN_ENDPOINT=/api/v1/testing/run
NEXT_PUBLIC_TEST_RUNS_ENDPOINT=/api/v1/testing/runs
NEXT_PUBLIC_APP_NAME=WebTest AI
NEXT_PUBLIC_ENABLE_MOCK_MODE=false
NEXT_PUBLIC_API_MODE=direct
```

Run the backend on port `3000` and the frontend on port `3001`.

The backend must allow this origin:

```env
FRONTEND_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:5173
```

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm test
npm run e2e
```
