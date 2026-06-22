# AI UiPath Flow Builder

MVP desktop/web application that turns a natural-language prompt into a safe, reviewable UiPath project scaffold.

## What this MVP does

- Next.js ChatGPT-like UI for entering an automation prompt.
- Node.js/Express TypeScript backend with modular agent, browser, UiPath, selector, desktop-control, and logging services.
- Rule-based prompt refinement and structured JSON plan generation.
- UiPath project generation under `generated-projects/{projectName}` with `project.json`, `Main.xaml`, and `automation-plan.json`.
- Playwright browser controller endpoints for opening a browser and sending refined prompts to a configurable AI page.
- Safety-first dry-run behavior, credential detection, masked logs, and explicit confirmation before opening UiPath Studio.

## Architecture

```text
frontend/                  Next.js web UI
backend/                   Express TypeScript API
backend/src/agent          Prompt refinement, plan generation, validation, safety
backend/src/browser        Playwright browser controller
backend/src/uipath         UiPath project and XAML generators
backend/src/selectors      Selector manager placeholder
backend/src/desktop-control Desktop/UiPath Studio integration placeholder
backend/src/logs           Log service with masking
templates/uipath           UiPath templates
generated-projects         Generated UiPath projects
logs                       Runtime logs
selectors                  Captured selector store
```

## Setup

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:4000

## Useful commands

```bash
npm run typecheck
npm run build
npm run dev -w backend
npm run dev -w frontend
```

## Example prompt

> Create a UiPath flow that opens Google, searches Facebook, opens Facebook, types Faris as username and faris1234 as password.

## Example generated automation plan

```json
{
  "projectName": "Generated_Create_a_UiPath_flow_that_opens_Goo",
  "summary": "MVP automation plan generated from natural language prompt.",
  "dryRun": true,
  "warnings": [
    "Credential-like text was detected in the prompt.",
    "Credentials detected. Values are masked in logs and should be replaced with UiPath secure credential assets.",
    "Some actions require explicit user confirmation before execution."
  ],
  "requiresConfirmation": true,
  "steps": [
    { "id": "step-1", "action": "log_message", "description": "Start generated automation" },
    { "id": "step-2", "action": "open_browser", "description": "Open browser", "target": "https://www.google.com" },
    { "id": "step-4", "action": "type_into", "selectorName": "google_search_box", "value": "Facebook" }
  ]
}
```

## Safety notes

- The full MVP flow creates files only; opening UiPath Studio is a separate endpoint requiring `confirmed: true`.
- Prompt credentials are detected and warnings are returned.
- Log messages are masked for password/token-like values.
- Sensitive XAML fields are generated as `[REPLACE_WITH_SECURE_CREDENTIAL]` placeholders.
- Drag-and-drop UiPath Studio control is intentionally deferred; direct file generation is the stable MVP path.
