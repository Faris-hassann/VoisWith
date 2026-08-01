# TesterFrontend

TesterFrontend is a Next.js App Router prototype for configuring and reviewing authorized web test runs from `TesterBackend`.

## Routes

- `/` redirects to `/testing/new`
- `/testing/new` configures and starts a test
- `/testing/results/[runId]` shows an in-memory completed report
- `/testing/history` explains backend history is unavailable
- `/settings` shows API configuration
- `/about` explains safety and limitations
- `/api/testing/run` optionally proxies to the backend when `NEXT_PUBLIC_API_MODE=proxy`

## Environment

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_API_DOCS_URL=http://localhost:3000/docs/
NEXT_PUBLIC_TEST_RUN_ENDPOINT=/api/v1/testing/run
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

## Notes

- OpenRouter keys never belong in the frontend.
- Playwright is never run by the frontend.
- Credentials are omitted from storage, query keys, URLs, review summaries, and logs.
- The backend currently exposes a single long-running test endpoint, so progress is indeterminate and history is unavailable.
