# TesterBackend

TesterBackend is an Express 5, TypeScript, Playwright, and OpenRouter backend for authorized black-box functional testing of websites and web applications.

It exposes:

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

## Setup

```bash
npm install
copy .env.example .env
npm run playwright:install:chrome
npm run dev
```

Then open:

```text
http://localhost:3000/docs
```

Add your OpenRouter secret manually in `.env`:

```env
OPENROUTER_API_KEY=your_secret_here
OPENROUTER_MODEL=your/model-name
```

Do not commit `.env`.

## Frontend Linking

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

## Safety

- Only test systems you own or are explicitly authorized to test.
- The caller must send `authorizationConfirmed: true`.
- Credentials are redacted from logs/errors and never sent to OpenRouter.
- AI plans are schema-validated and policy-checked before Playwright execution.
- Safe mode blocks destructive, payment, message-sending, permission-changing, and legal-acceptance actions by default.
- The AI receives sanitized page snapshots with internal element IDs only; it never receives cookies, passwords, tokens, or raw HTML.
- Authorization checks only run when explicit role credentials are supplied.

## Architecture

The backend runs authorized black-box website tests using:

```text
create run -> launch Playwright -> authenticate -> iterative DFS crawl -> scan/fingerprint page state
-> AI JSON test planning -> schema/policy validation -> deterministic Playwright execution
-> artifacts/report -> final cross-page diagnostics
```

The crawler uses an explicit stack and convergence tracking for discovered URLs, visited URLs, visited state fingerprints, pending crawl items, processed interactions, and route families. Requests may provide emergency `crawl.maxPages` or `crawl.maxDepth`, but they are not required for normal exhaustive crawling.

## Live View

Local mode opens headed Chrome on the backend machine when `browserMode` is `headed`.

Remote/live mode sends compressed screenshot frames through the existing WebSocket as `live-view:frame` events. Configure with:

```env
LIVE_VIEW_ENABLED=true
LIVE_VIEW_FRAME_INTERVAL_MS=1500
```

## Environment Variables

Important values:

```env
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_CHANNEL=chrome
AI_RESPONSE_TIMEOUT_MS=30000
ACTION_TIMEOUT_MS=10000
NAVIGATION_TIMEOUT_MS=30000
TEST_RUN_ALLOWED_ORIGINS=
SCREENSHOT_DIRECTORY=artifacts/screenshots
TRACE_DIRECTORY=artifacts/traces
```

Legacy `BROWSER_*`, `OPENROUTER_TIMEOUT_MS`, and `PAGE_NAVIGATION_TIMEOUT_MS` variables still work.

## System Test

Start the backend, then run the TrueForm system test with credentials in memory:

```powershell
npm run dev
$env:TRUEFORM_PASSWORD="..."
npm run trueform:system-test
```

The script starts an async run, polls until completion, and writes the final snapshot under `artifacts/manual-runs`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
```
