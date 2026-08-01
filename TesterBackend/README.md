# TesterBackend

TesterBackend is an Express 5, TypeScript, Playwright, and OpenRouter backend for authorized black-box functional testing of websites and web applications.

It exposes:

```text
GET  /docs
GET  /openapi.json
POST /api/v1/testing/run
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
http://localhost:3000/api/v1/testing/run
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

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
```
