# VoisWith

This repository contains two projects:

- [TesterBackend](TesterBackend/README.md), an Express 5, TypeScript, Playwright, and Qwen backend for authorized black-box functional testing.
- [TesterFrontend](TesterFrontend/README.md), a Next.js App Router frontend for configuring and reviewing runs from the backend.

## Repository Layout

```text
TesterBackend/   Express + Playwright backend
TesterFrontend/  Next.js frontend
```

## TesterBackend

TesterBackend exposes these endpoints:

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

When `AUTO_OPEN_SWAGGER=true`, running `npm run dev` opens Swagger automatically.

### Setup

```bash
cd TesterBackend
npm install
copy .env.example .env
npm run playwright:install:chrome
npm run dev
```

Then open:

```text
http://localhost:3000/docs
```

Add your Qwen secret manually in `.env`:

```env
QWEN_API_KEY=your_secret_here
QWEN_API_URL=https://qwen.snouhy.com/chat
QWEN_TIMEOUT_MS=60000
```

Qwen receives the canonical Markdown planner prompt from `TesterBackend/src/prompts/form-test-planner.system.md` plus sanitized `{ formCount, forms }` input in a single `message` payload. If `QWEN_API_KEY` is missing or rejected, deterministic planning still runs and the AI failure is surfaced only in diagnostics.

Do not commit `.env`.

### Frontend Linking

Set allowed frontend origins in `.env`:

```env
FRONTEND_ORIGINS=http://localhost:3000,http://localhost:5173
```

Your frontend can call:

```text
http://localhost:3000/api/v1/testing/runs
```

Swagger/OpenAPI is available for generating clients:

```text
http://localhost:3000/openapi.json
```

### Safety

- Only test systems you own or are explicitly authorized to test.
- The caller must send `authorizationConfirmed: true`.
- Credentials are redacted from logs/errors and never sent to Qwen.
- AI plans are schema-validated and policy-checked before Playwright execution.
- Safe mode blocks destructive, payment, message-sending, permission-changing, and legal-acceptance actions by default.
- The AI receives sanitized page snapshots with internal element IDs only; it never receives cookies, passwords, tokens, or raw HTML.
- Authorization checks only run when explicit role credentials are supplied.

### Architecture

The backend runs authorized black-box website tests using:

```text
create run -> launch Playwright -> authenticate -> iterative DFS crawl -> scan/fingerprint page state
-> AI JSON test planning -> schema/policy validation -> deterministic Playwright execution
-> artifacts/report -> final cross-page diagnostics
```

The crawler uses an explicit stack and convergence tracking for discovered URLs, visited URLs, visited state fingerprints, pending crawl items, processed interactions, and route families. Requests may provide emergency `crawl.maxPages` or `crawl.maxDepth`, but they are not required for normal exhaustive crawling.

### Live View

Local mode opens headed Chrome on the backend machine when `browserMode` is `headed`.

Remote/live mode sends compressed screenshot frames through the existing WebSocket as `live-view:frame` events. Configure with:

```env
LIVE_VIEW_ENABLED=true
LIVE_VIEW_FRAME_INTERVAL_MS=1500
```

### Environment Variables

Important values:

```env
QWEN_API_KEY=
QWEN_API_URL=https://qwen.snouhy.com/chat
QWEN_TIMEOUT_MS=60000
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_CHANNEL=chrome
AI_RESPONSE_TIMEOUT_MS=30000
ACTION_TIMEOUT_MS=10000
NAVIGATION_TIMEOUT_MS=30000
TEST_RUN_ALLOWED_ORIGINS=
SCREENSHOT_DIRECTORY=artifacts/screenshots
TRACE_DIRECTORY=artifacts/traces
```

Legacy `BROWSER_*` and `PAGE_NAVIGATION_TIMEOUT_MS` variables still work.

### System Test

Start the backend, then run the TrueForm system test with credentials in memory:

```powershell
cd TesterBackend
npm run dev
$env:TRUEFORM_PASSWORD="..."
npm run trueform:system-test
```

The script starts an async run, polls until completion, and writes the final snapshot under `artifacts/manual-runs`.

### Scripts

```bash
cd TesterBackend
npm run dev
npm run build
npm run lint
npm test
```

## TesterFrontend

TesterFrontend is a Next.js App Router prototype for configuring and reviewing authorized web test runs from `TesterBackend`.

### Routes

- `/` redirects to `/testing/new`
- `/testing/new` configures and starts a test
- `/testing/running/[runId]` streams WebSocket events, live-view frames, DFS discovery, and run controls
- `/testing/results/[runId]` shows an in-memory completed report
- `/testing/history` explains backend history is unavailable
- `/settings` shows API configuration
- `/about` explains safety and limitations
- `/api/testing/runs` optionally proxies async backend runs when `NEXT_PUBLIC_API_MODE=proxy`

### Environment

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

### Commands

```bash
cd TesterFrontend
npm install
npm run dev
npm run typecheck
npm run build
npm test
npm run e2e
```

### Notes

- Qwen keys never belong in the frontend.
- Playwright is never run by the frontend.
- Credentials are omitted from storage, query keys, URLs, review summaries, and logs.
- The backend returns a run ID immediately, then streams status, live-view frames, generated tests, and final report state over WebSocket with polling fallback.
- Pause, resume, stop, and JSON report download are routed through the backend run API.
