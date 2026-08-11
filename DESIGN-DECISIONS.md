# TesterBackend / TesterFrontend — Settled Design Decisions

Output of 8 grilling rounds, 49 questions. Every decision below is settled.
This document remains the canonical contract; implementation progress is recorded in §14.

**This file is canonical.** Implementation plans, code comments, and tests reference sections here rather than restating enums, limits, formulas, regexes, budgets, or mappings. If a value appears in two places, this one wins. Commit it to the repo — it is not a chat artifact.

**Amendment 1 (post-plan-review).** Corrections made after the plan passes, all reflected inline below: `ai_budget` removed from `stoppedReason` (§3); `status` alias mapping defined (§3); `INCONCLUSIVE` excluded from the LLM `expectedOutcome` enum (§3, §6); `.strict()` boundary behaviour defined (§3); `allowFormSubmission` defaults false and `writeActionsAcknowledged` is required whenever submission is enabled, credentials or not (§4); model-ID configuration must fail loudly (§5); `run.not_found` defined and the heartbeat/reconnect spec made explicit (§9); deterministic data generator moved to Phase 2 (§12).

---

## 1. Scope

| Decision | Value |
| --- | --- |
| Microsoft Power Apps | **Out of v1.** Not in scope, not in the pitch. |
| LLM provider | Qwen at `https://qwen.snouhy.com/chat`. No paid fallback. |
| Demo target | `staging.trueform.cultivbureau.com`, admin credentials |
| Acceptance target | Local fixture (see §11) — **not** TrueForm |
| `entertab.net` | Not a target. Illustration only. Not in any allowlist or config. |
| Product framing | **Generic.** No target-specific tuning anywhere in the code. |

**Open security item:** the admin password shared in chat must be rotated. Staging should sit behind basic auth or an IP allowlist.

---

## 2. Test-type tiers

`PASSIVE_SECURITY` remains *Implemented* but is **unchecked by default**, because a checked-by-default security label promises more than an HTTPS observation delivers.

**Checked by default (12):**
`SMOKE`, `PAGE_DISCOVERY`, `NAVIGATION`, `LINKS`, `FORMS`, `FORM_VALIDATION`, `AUTHENTICATION`, `API_NETWORK`, `ERROR_HANDLING`, `PERFORMANCE_BASIC`, `CONSOLE_ERRORS`, `ACCESSIBILITY_TECHNICAL`

**Selectable, unchecked, labelled "Implemented" (1):** `PASSIVE_SECURITY`

**Selectable, unchecked, labelled "Partial" (3):** `SESSION`, `AUTHORIZATION`, `CHROMIUM_COMPATIBILITY`

**Selectable, unchecked, labelled "Planned — limited results" (9):**
`POSITIVE`, `NEGATIVE`, `BOUNDARY`, `END_TO_END`, `BUSINESS_RULES`, `FILE_UPLOAD_SAFE`, `DATA_INTEGRITY_OBSERVABLE`, `RELIABILITY_BASIC`, `REGRESSION_BASELINE`

Every **selected** type gets a `coverageLimitations` entry — `{ testType, availability, executed, reason }` — rendered above the summary cards. A selected-but-unimplemented type must never produce a silent empty result.

---

## 3. Contracts (Phase 1 — everything compiles against these)

### FormSnapshot — the only thing sent to the LLM

```json
{
  "formId": "sha1(fieldSignature)",
  "routeFamily": "/services/:id",
  "method": "POST",
  "submitLabel": "Request Service",
  "fields": [
    { "elementId": "e12", "label": "Work Email", "type": "email",
      "required": true, "maxLength": 64, "pattern": null,
      "placeholder": "you@company.com", "options": null }
  ]
}
```

Enforced exclusions in the serializer: no `value`, no hidden inputs, no CSRF tokens, no cookies, no raw HTML, no full URL (route family only). Select `options` capped at 20.

### TestCase — LLM output

```json
{
  "caseId": "fv-003",
  "formId": "...",
  "testType": "FORM_VALIDATION",
  "intent": "email field rejects malformed address",
  "inputs": [{ "elementId": "e12", "value": "not-an-email" }],
  "submit": true,
  "expectedOutcome": { "kind": "VALIDATION_ERROR", "elementId": "e12" }
}
```

**The LLM never emits a selector.** It may only reference `elementId`s supplied in the snapshot. Validator rejects: unknown `elementId`, any key outside the schema, any `value` over 500 chars, more than 12 cases per form.

`expectedOutcome.kind` is a closed enum of exactly **five** values:
`VALIDATION_ERROR | FIELD_ERROR | SUBMIT_ACCEPTED | NO_NAVIGATION | ERROR_MESSAGE_SHOWN`

`INCONCLUSIVE` is **not** in this enum. It exists only in the assertion *result* space (§6) — it is what the engine returns when it observes nothing, never something the LLM may expect. An expectation of `INCONCLUSIVE` would be unassertable by construction and would pass trivially.

Every object boundary in the LLM response schema is `.strict()`. Unknown keys are a **validation failure** (`llm_schema_invalid`), never silently stripped — Zod's default strip behaviour would let a model smuggle a field the executor might later read.

### Status — split into two fields

| Field | Values | Means |
| --- | --- | --- |
| `runStatus` | `COMPLETED` / `STOPPED` / `ERRORED` | Did **our tool** finish its job |
| `findingsStatus` | `PASSED` / `ISSUES_FOUND` / `INCONCLUSIVE` | What we found in **the target** |
| `status` | computed alias | Deprecated; kept so the frontend doesn't break |

A run finding 2 real bugs is `COMPLETED` + `ISSUES_FOUND` — a successful run.

The alias maps onto the **existing** `status` enum (`PASSED | FAILED | PARTIAL | ERROR | INCONCLUSIVE`) and introduces no new strings — an alias that emits values old consumers have never seen is just a third status field:

| `runStatus` + `findingsStatus` | `status` |
| --- | --- |
| `ERRORED` + any | `ERROR` |
| `STOPPED` + any | `PARTIAL` |
| `COMPLETED` + `PASSED` | `PASSED` |
| `COMPLETED` + `ISSUES_FOUND` | `FAILED` |
| `COMPLETED` + `INCONCLUSIVE` | `INCONCLUSIVE` |

### stoppedReason

Added to the report, the async snapshot, and the `run.completed` payload:
`converged | page_budget | depth_budget | time_budget | user_stopped | error`

Anything other than `converged` renders a coverage banner in the results UI.

`ai_budget` is deliberately **not** a stop reason. Exhausting `MAX_AI_CALLS_PER_RUN` or `MAX_AI_TEST_CASES_PER_RUN` never ends a run — crawling and deterministic checks continue. It is reported as a `coverageLimitations` entry, so a run that completed fully is never mislabelled as budget-stopped.

---

## 4. Safety

### Two consent gates

`authorizationConfirmed: true` — unchanged.

`execution.allowFormSubmission` defaults to **`false`** — in backend validation, legacy request normalization, frontend schema, and initial UI state. Writes are always opt-in.

`writeActionsAcknowledged: true` — **new**, required by the backend and shown in the UI whenever `allowFormSubmission === true`, **regardless of whether credentials are supplied**. An anonymous run that submits forms still writes to the target. Hidden and not required when submission is off.

> This run will submit forms to the target. Records may be created. Use a non-production environment.

When credentials *are* supplied, use stronger copy:

> This run will submit forms using this account's privileges. Records may be created. Use a non-production environment and an account with the lowest privileges needed.

Enforced at the backend, not just the UI — the frontend condition and the backend condition must be identical, or a credential-free run with submission enabled is rejected with no checkbox on screen to satisfy.

### Privileged-form classifier

Runs on scraped field data in the inspector output, **before** `ai-test-planner.ts` is called — privileged forms are never sent to the LLM at all. No URL denylist; no target-specific tuning. **Fails closed.**

**Hard block** (never planned, never submitted) if any of:
- a `type=password` field on a page that is not the detected login
- a field name/label matching `role|permission|scope|grant|admin|owner|tenant|billing|plan|api[_-]?key|secret`
- a submit label matching `delete|remove|revoke|deactivate|suspend|reset|purge|transfer|invite|send|pay|upgrade|downgrade`
- `method=DELETE`, or a form action containing `delete|remove|revoke`

**Soft block** (filled, never submitted):
- 1–2 fields with no clear validation surface
- page heading matching `settings|configuration|users|team|members|permissions`

**Unknown or unparseable → soft block.**

Every decision logged: `{ formId, decision: "blocked_privileged", matchedSignal: "submit_label:invite" }`.

Blocked action categories in safe mode gain `CREATE_ACCOUNT` and `MODIFY_SETTINGS` — the existing list covers destructive/payment/messaging/permissions/legal, and creates were not among them.

Expect the verb lists to need calibration over the first three real runs. That is tuning, not a reopened decision.

### Captcha and consent checkboxes

- Captcha detected (`recaptcha` / hCaptcha / Turnstile iframes) → form marked `SKIPPED_CAPTCHA`. **Never attempted.**
- Terms/consent checkboxes may be ticked, and are logged explicitly in the report: *"accepted checkbox: Terms of Service"*.

### Test data

Deterministic `form-data-generator.ts` is the **default and the fallback**. LLM values are used only when schema-valid, and are always logged in the report beside the field.

Every record is greppable and deletable: `ZZTEST-<runId>` in the first free-text field, `qa+<runId>@<target>.test` for emails, reserved `+1-555-01xx` phone block. Format-valid, never belonging to a person.

---

## 5. LLM pipeline

| Setting | Value |
| --- | --- |
| Batch size | 3 forms, or ~4k estimated input tokens — whichever hits first |
| Concurrency | Sequential, one request in flight (never 429s on free tier) |
| Model chain | Exactly 3 pinned free model IDs from config, tried in order. **Not** `openrouter/auto` (paid). Missing or blank IDs fail configuration validation loudly at startup — never substituted, never defaulted |
| Retry | attempt 1 normal → attempt 2 repair prompt with the parse error → attempt 3 next model → deterministic generator |
| `MAX_AI_CALLS_PER_RUN` | 25 (≈75 forms; higher risks the shared daily key ceiling) |
| Cases per form | prompt asks 5–8; validator hard-caps at 12 |
| `MAX_AI_TEST_CASES_PER_RUN` | 400 |

Batching rather than one giant request because free models cap output around 4–8k tokens: one oversized site would truncate deterministically on all three attempts and produce zero AI cases for the entire run. A failed batch costs 3 forms.

**Typed failure reasons — never "failed to connect":**
`llm_transport_error`, `llm_rate_limited`, `llm_invalid_json`, `llm_schema_invalid`, `llm_truncated`, `llm_unavailable`

Deterministic `FORMS` and `FORM_VALIDATION` checks run to completion regardless of AI availability. Excess cases report as `truncated_by_budget` in `coverageLimitations`, never silently dropped.

---

## 6. Assertion rules

After submit, wait up to **5s** for network idle or DOM mutation, then:

| Outcome | Passes when |
| --- | --- |
| `VALIDATION_ERROR` | native `:invalid` on target, or `[aria-invalid=true]`, or new visible text in the field container — **and** URL unchanged |
| `FIELD_ERROR` | same, scoped strictly to the `elementId` container |
| `SUBMIT_ACCEPTED` | URL changed, or a success element appeared (`[role=status]`, `.success`, text matching `thank\|success\|received\|submitted`) — **and** no visible error text |
| `NO_NAVIGATION` | URL unchanged after the wait |
| `ERROR_MESSAGE_SHOWN` | any visible error-role element appeared |
| `INCONCLUSIVE` | nothing observable in 5s; reason recorded |

`INCONCLUSIVE` is never counted as passed, and gets its own summary card.

---

## 7. Form dedup

**Amendment 2 (post-Phase-4, resolves a self-contradiction found during acceptance).** The original formula included `routeFamily`, which defeats the dedup this section's own prose promises: a footer form appearing on `/about` and `/pricing` hashed to two different `formId`s because `routeFamily` differs per page, so `form:duplicate_skipped` never fired for genuinely repeated components. `routeFamily` is dropped from `formId` below. It remains in use elsewhere (§9 crawl-instance identity) — only the form-level formula changes.

```
fieldSignature = sha1(sorted(field.name || field.label || elementRole + ":" + type).join("|"))
formId         = sha1(fieldSignature)
```

`fieldSignature` deliberately excludes `elementId` (regenerates per page) and all values.

A `formId` already in `processedForms` is skipped: `decision: "duplicate_of:<firstPageUrl>"`. **One form, tested once, on the first page it appears** — even though the route-family rule still permits visiting 3 instances of a route.

**Known limitation, accepted deliberately:** two structurally-identical-but-semantically-distinct forms (e.g. a "Contact Us" and a "Request a Quote" form that happen to declare the same field set) will be deduped as one. This is auditable, not silent — it surfaces as a `duplicate_of` entry naming the first page, so a human reviewing the report can see it happened. Judged an acceptable trade against the alternative (routeFamily-scoped dedup, which silently under-deduplicates far more often — the actual bug this amendment fixes).

---

## 8. Severity — assigned mechanically, never by the LLM

| Level | Issues |
| --- | --- |
| `CRITICAL` | page failed to load, login failed, uncaught exception breaking a form |
| `HIGH` | form accepted invalid input, submit did nothing, 5xx observed |
| `MEDIUM` | console errors, failed network requests, missing validation attributes |
| `LOW` | accessibility name gaps, slow page timings |
| `INFO` | coverage limitations, skipped or blocked forms |

The LLM's `intent` string is displayed as description only, never mapped to severity.

---

## 9. Run scale and durability

| Budget | Value |
| --- | --- |
| `maximumRunDurationSeconds` | 10800 (3h hard ceiling) |
| Max pages | 500 |
| Max depth | 7 |
| Instances per route family | 3 |
| Context recycle | every 50 pages, restored from saved `storageState`, emits `browser.recycled` |

Whichever budget trips first sets `stoppedReason`.

**Crawl scoping:** route-family normalization — strip ignored query params, replace numeric and UUID path segments with `:id`, key on `route_family + DOM structure hash`.

**Unplanned exit** (OOM, host restart, deploy, Ctrl+C): `artifacts/<runId>/manifest.json` is written after **every page** — run config, counts, pages completed, `terminalStatus: null`. On backend startup, any manifest with `terminalStatus: null` is marked `runStatus: ERRORED`, `stoppedReason: "error"`, and still renders in history from the per-page reports already on disk.

**Stream recovery:** ring buffer of the last ~2000 events per run. Client sends `?lastSequence=N` on connect; server replays after `N`, then goes live.

**Heartbeat and reconnect:** server pings every 30s; client responds and treats **two missed pings** as a dead socket. Client reconnects with exponential backoff after any close code **other than 1000**, resuming from `?lastSequence=N`. When a socket cannot be maintained at all (blocked upgrade, hostile proxy), the client falls back to polling the async run endpoint every **10s** until terminal state.

**`run.not_found`** fires only when the run ID is absent from *all three*: the live registry, the retained terminal event buffer, and disk-backed history. With history on disk and a 10-minute terminal buffer, a reconnect to a finished run replays to a terminal state instead of erroring.

**Terminal sequence:** `run.completed` (final counts + `stoppedReason`) → `run.report_ready` → 2s grace → close with code **1000**, reason `"run_complete"`. Client never reconnects on 1000; any other code reconnects with `?lastSequence=N`. Ring buffer retained **10 minutes** past termination so a late reconnect replays to a terminal state instead of `run.not_found`.

**Persistence** (moved from cuttable to cannot-cut at 3-hour runs): `GET /api/v1/testing/runs` list; `GET /api/v1/testing/runs/:runId` reads from disk when the run has left the registry. `/testing/history` becomes a real list. Results page reads disk-backed history, not the in-memory store that dies with the socket.

**Retention:** `ARTIFACT_RETENTION_DAYS=14`, swept on startup and after each run. Traces `retain-on-failure` only. Screenshots JPEG q70, viewport-only unless there's an issue. Report JSON kept the full window. `artifactsBytes` in the summary, warning past 1GB per run.

---

## 10. WebSocket contract — additions only

No renames, no removals. New: `ai.batch_started`, `ai.batch_failed` (carries the typed `llm_*` reason), `form:blocked_privileged`, `form:duplicate_skipped`, `live-view:cursor`, `browser.recycled`. Plus `stoppedReason` on the existing `run.completed` payload.

Every new type gets UI handling in the same release. The `run.event` switch still gets a `default` branch routing unknown types into the raw feed rather than throwing.

Both README event tables are updated in the same commit as the emitter change — they are the contract document.

### Live-view cursor

Cursor travels as **data, not pixels**: `live-view:cursor` `{x, y, action}` at high frequency (tens of bytes), animated by a CSS overlay on top of the slower JPEG stream. Global frame interval stays at 1500ms.

Overlay injection: via `addInitScript` so it survives navigation, into a **shadow root** on `documentElement`, `pointer-events: none`, `z-index: 2147483647`. Hidden for the duration of every screenshot. Explicitly skipped by `element-inventory.ts` so it can't pollute `ACCESSIBILITY_TECHNICAL`. Local headed mode only — never headless, never during assertion evaluation, zero influence on pass/fail.

---

## 11. Acceptance run

Expand the existing `127.0.0.1:43117` fixture into the acceptance target: 6 pages, a login, and 4 forms with **deliberately seeded** defects — one accepting an invalid email, one whose submit does nothing, one with no validation attributes, one clean control.

Acceptance = exactly the expected finding set, `runStatus: COMPLETED`, `findingsStatus: ISSUES_FOUND`, `stoppedReason: converged`, zero inconclusive on the seeded four. CI-runnable regression test, not a demo.

TrueForm staging is then a **manual** demo run whose only criterion is that it completes with a coherent report.

---

## 12. Build order

| Phase | Contents | Status |
| --- | --- | --- |
| **1. Contracts** | `FormSnapshot`, `TestCase`, `expectedOutcome` enum, `stoppedReason`, split `runStatus`/`findingsStatus`, `coverageLimitations` population | ✅ Complete |
| **2. Safety** | privileged-form classifier, `CREATE_ACCOUNT`/`MODIFY_SETTINGS` blocked categories, `writeActionsAcknowledged` gate, captcha skip, consent logging, **deterministic data generator** | ✅ Complete |
| **3. LLM path** | 3-form batching, model chain, typed failures, output caps, deterministic fallback | ✅ Complete — see §14 |
| **4. Assertions** | six evaluation rules, mechanical severity table, form dedup | ✅ Complete — see §14 |
| **5. Persistence** | manifest durability, disk-backed history, `GET /runs`, retention sweep, `artifactsBytes`, stream recovery | ✅ Complete — see §14 |
| **6. Live view** | shadow-root cursor overlay, `live-view:cursor` | âœ… Complete â€” see Â§14 |

Nothing starts before Phase 1 — the schemas are load-bearing for the validator, policy engine, executor, report, and UI simultaneously. Phase 6 is the demo feature and the one most tempting to build first; it animates a broken pipeline if 1–4 aren't green.

### Frontend work list

- `ResultsDashboard.tsx` — two distinct status badges; `stoppedReason` banner when ≠ `converged`
- **new** `CoverageLimitations.tsx` — per-type executed table, above the summary cards
- `TestSummaryCards.tsx` — `inconclusive` as its own card, never folded into passed
- `RunningTestPanel.tsx` — `ai.batch_started`, `ai.batch_failed` (typed reason), `form:blocked_privileged`, `form:duplicate_skipped`, `browser.recycled`
- **new** `CursorOverlay.tsx` — consumes `live-view:cursor`
- `TestingTypesSelector.tsx` — four tiers, 12 checked by default
- `history/page.tsx` — real list from `GET /api/v1/testing/runs`; delete the apology copy
- `types.ts` / `testing-run.schema.ts` — mirror every backend contract change
- WebSocket client — `?lastSequence=N` reconnect, close-code-1000 handling

---

## 13. Cut list

Declined — everything ships. Kept written down anyway, because a cut list you don't use isn't cancelled, it just gets written at 2am by whoever is awake.

**Cannot cut, under any circumstance** — these exist so the report doesn't lie:
split status fields · `coverageLimitations` honesty · privileged-form classifier · `stoppedReason` · hard crawl budgets · manifest durability

**Order of sacrifice if it comes to that:**
cursor overlay → retention sweep → `ai.batch_*` UI granularity → third model in the chain

Disk-backed history left the cuttable list when the runtime ceiling moved to 3 hours.

---

## 14. Implementation status log

### Phase 1 — Complete
`FormSnapshot`, `TestCase` (renamed `FormTestCase` internally — the name `TestCase` is taken by the old page-level planner type, removed in Phase 3), the five-value `expectedOutcome` enum, `stoppedReason`, split `runStatus`/`findingsStatus` with alias mapping, `coverageLimitations`, `artifactsBytes` (sum only — see Phase 2 fix). OpenAPI and both READMEs updated in the same pass. 39 → 112 tests.

### Phase 2 — Complete
Fixed post-Phase-1 bugs found on a real `entertab.net` run (read-only, no submission): `openrouter/free` was never a valid slug — replaced with `OPENROUTER_MODELS` (3 pinned, comma-separated), enforced offline at parse time and live at boot via `openrouter-preflight.ts`, which fetches the real catalogue and refuses to start on a delisted slug. `npm run openrouter:models` prints the live `:free` catalogue rather than relying on memory — **use this before pinning, the catalogue rotates.** `stoppedReason` was hardcoded to `converged` regardless of exit reason — now recorded at every crawler break site. Tool failures (AI misconfiguration) were leaking into `issues` as target defects — now `diagnostics.ai.failures` + a `coverageLimitations` row only. `artifactsBytes` was `artifact.path ? 0 : 0` — now stats every written file, **confirmed non-zero on live runs (47,959 bytes)**. `MAX_AI_CALLS_PER_RUN` 50→25. 96 → 136 tests.

**Diagnostic checks run before Phase 3, both passed:** `stoppedReason` stays `converged` with `MAX_AI_CALLS_PER_RUN=0` (verified live). `artifactsBytes` non-zero on live runs — **but disk-backed history read-back does not exist yet; that stat is correctly deferred to Phase 5, not a Phase 2 gap.**

### Phase 3 — Complete
`ai-test-planner.ts` wired to the Phase 1 contract: batches 3 forms / ~4k tokens, builds sanitized `FormSnapshot`s, runs each batch through `normal → repair → next model → deterministic fallback` via a `validate` callback on `openrouter-client.ts` that folds schema failures into the same repair path as parse failures. Old page-level path deleted (`ai-context-builder.ts`'s open-ended prompt, `ai-response-validator.ts`, the 100-case/100-step schema).

Fixed in the same pass: `openrouter-client.ts` now accumulates `attempts[]` (`{model, reason, message}`) across every model and repair attempt instead of discarding all but the last — surfaced in `diagnostics.ai.failures[].attempts`. `OPENROUTER_MAX_OUTPUT_TOKENS` 3000→6000 (reasoning models spend budget on `reasoning_details` before emitting JSON). Prompt now caps output (~6 cases, ~4 steps) — the old prompt had no cap at all. Pacing added: `AI_CALL_PACING_MS` (default 1500) before every AI call after the first in a run; `Retry-After` honored on 429. `truncated_by_budget` now counts `MAX_AI_TEST_CASES_PER_RUN` specifically, not the call budget. Deterministic generator confirmed as the retry ladder's actual last rung, not a separate path. 143 → 161 tests.

**Live verification (the gate that matters — a green suite alone was not treated as sufficient):** real run against `127.0.0.1:43117`, 3 pinned `:free` models, produced schema-valid `FormTestCase`s on both pages reached — 5 and 6 cases, zero fallbacks, zero failures. `testsExecuted` unaffected; planned cases live in `plannedTestCases` only.

**Live-verified model chain** (re-confirmed against `npm run openrouter:models` at the start of Phase 4 — all three still listed):

```
OPENROUTER_MODELS=nvidia/nemotron-nano-9b-v2:free,poolside/laguna-s-2.1:free,poolside/laguna-xs-2.1:free
```

The catalogue rotates, so re-run `npm run openrouter:models` before any demo and update this line if a slug has been delisted. **Latency note measured on these three:** a single planning call takes **~55-75s** on the free tier. Budget `maximumRunDurationSeconds` accordingly — a 120s budget is not enough for more than one page, which is exactly what broke the Phase 3 fixture run.

### Phase 4 — Historical blocker/root cause (superseded by the closure entry below)
**Corrected.** The earlier version of this entry blamed a false positive in state-fingerprint/route dedup and pointed at `state-fingerprint-service.ts` / `url-canonicalizer.ts`. That was wrong, and it was wrong because the `duplicate-or-visited` skip *label* was taken at face value without reading the crawler's own event log. Both files are innocent; dedup was never involved.

The crawler's event log for that run ends:

```
[INFO]    Links discovered  | /       | 3 candidates, 2 accepted, 1 skipped.
[INFO]    Crawler popped URL| /login  | Depth 1, source element_2.
[INFO]    Links discovered  | /login  | 3 candidates, 0 accepted, 3 skipped.
[SKIPPED] Crawler stopped   |         | Run deadline exceeded.
```

`/contact` was discovered and queued correctly — the home page's own `link-health-3` fetched it and got HTTP 200. It was **never popped**, because the crawl ran out of time with it still on the stack: **133.2s elapsed against a `maximumRunDurationSeconds` of 120**, of which the two free-tier AI calls consumed **72s and 56s**. The budget was simply too small for the workload; that part is a test parameter, not a code defect.

Two real reporting defects sat behind it, and both are now fixed and regression-tested:

1. **`stoppedReason` was lost.** The crawler set `time_budget` on the per-matrix-target local context; the parent context never received it, so the aggregator fell back to `converged`. A truncated crawl reported itself complete. Fixed by `mergeStoppedReason` (most-severe-wins) in `run-orchestrator.ts`; covered by `run-orchestrator-stopped-reason-merge.test.ts`.
2. **The unreached page was invisible.** `duplicate-or-visited` was applied to *any* already-visited-or-queued link, so a genuinely unreached page was indistinguishable from a repeat nav link. Fixed by the `alreadyAccountedFor` guard plus a post-loop pass recording `not-reached:<stoppedReason>` and `diagnostics.crawl.unreachedUrls`; covered by `page-crawler-unreached.test.ts`, whose two bug-pinning assertions were verified to fail against the pre-fix code.

Lesson worth keeping: a skip *label* is not a root cause. The crawler already emitted the true reason in `diagnostics.crawl.events`; reading it first would have saved the misdiagnosis.

### Phase 4 — Assertions, dedup, severity: built and wired, acceptance **not** fully green
§6 evaluation, §7 dedup, §8 severity and the §4 privileged-form classifier are implemented, wired, and covered (161 → 214 tests). `outcome-evaluator.ts`, `severity.ts` and `form-dedup.ts` existed but were imported by nothing; they now run in the real path via a new `form-test-executor.ts`, and the planner receives snapshots that are already classified and deduped.

**Four defects found only by running it live** — each invisible to a green suite:

1. **`ReferenceError: __name is not defined`** on every form page. `outcome-evaluator.ts` passed *functions* to `page.evaluate`; tsx/esbuild rewrites named function expressions to reference its `__name` helper, which does not exist in the browser. Every form page came back `ERROR`. Fixed by using string-form evaluate, which is why `element-inventory.ts` and `login-detector.ts` already did.
2. **Field-scoped outcomes never evaluated.** `collectOutcomeFacts` needs a CSS selector, but the inventory prefers `role`/`label` locators, so `targetSelector` was almost always `undefined` — real `VALIDATION_ERROR`s silently read as `NO_NAVIGATION` and produced phantom MEDIUMs. Fixed by carrying `cssSelector` on `ElementInventoryItem`.
3. **Same-URL POST invalidated later cases.** A form posting to its own path leaves the URL unchanged while replacing the DOM, so the URL-based "did we navigate away" guard missed it and every subsequent case filled fields that no longer existed. Now the page reloads unconditionally between cases.
4. **`<button type="submit">Sign in</button>` was not recognised as a submit control.** `kindFor` matched only on button *text* (`submit|save|continue|send`), ignoring the `type` attribute, so most real forms had no submit control at all. Fixed to honour `type` and HTML's in-form default.

Also fixed: the live-view cursor overlay called `document.head.appendChild` at document-start before `<head>` existed, throwing into the page console on every navigation — **102 console errors that the CONSOLE_ERRORS check then reported as target defects.** Same "tool failure leaking into issues" class as the Phase 2 bug. Now guarded; the fixture run reports 0.

**Historical acceptance status:** at this point no single run had met §11 in full. Superseded by the Phase 4 closure entry below.
- With AI live (runs 3 and 4): all 7 pages reached including `/contact`, `runStatus: COMPLETED`, `findingsStatus: ISSUES_FOUND`, `stoppedReason: converged`, **zero inconclusive**, and all four seeded defects detected — invalid email accepted (HIGH), submit did nothing (HIGH), missing validation attributes (MEDIUM), clean control passing.
- The final run, after removing fixture noise, hit **429 on all three models** (five consecutive runs exhausted the shared free-tier ceiling) and degraded to the deterministic generator. It stayed COMPLETED/converged with zero inconclusive, but the deterministic fallback caught only 2 of 4 seeded defects: it emits `INVALID_EMAIL` only for fields already typed `type=email`, so it cannot catch the seeded `type=text` email field. **That is a real coverage limit of the deterministic rung, not a flake.**

**Those two items are now resolved:** Amendment 2 drops `routeFamily` from `formId`, and the deterministic planner infers bounded field intent from name/label/placeholder metadata.

### Phase 4 — Complete

Cross-page form identity now hashes only the field signature; the LLM-facing `routeFamily` is path/query shape only. The deterministic planner recognizes email/phone/postal and a bounded set of ordinary field semantics, fills non-target required fields during invalid-input cases, and emits canonical greppable data (`ZZTEST-<runId>`, target-host `.test` email, reserved 555 phone). A contract audit also found the previously-unspecified classifier correction: hidden privilege/password fields were being ignored even though §4 fails closed. They are now hard-block signals while remaining excluded from LLM snapshots.

The §11 fixture passed twice on 2026-08-11:

- `npm run acceptance:deterministic`: 7 pages, exactly the seeded invalid-email HIGH, submit-did-nothing HIGH, and missing-validation MEDIUM findings; clean login; zero inconclusive; `COMPLETED / ISSUES_FOUND / converged`; duplicate footer event observed.
- `npm run acceptance:live`: same acceptance result, 5 schema-valid AI batches, 28 generated cases, zero deterministic fallbacks. The live gate requires `diagnostics.ai.successes >= 1`, so a fully degraded run cannot masquerade as primary-path verification.

Live catalogue and verified chain:

```
OPENROUTER_MODELS=nvidia/nemotron-nano-9b-v2:free,poolside/laguna-s-2.1:free,poolside/laguna-xs-2.1:free
```

The explicit live acceptance command uses a 90-second response timeout because the default 30 seconds is below observed free-tier latency; normal runtime configuration is unchanged.

### Phase 5 — Complete

Runs now atomically checkpoint a redacted, versioned manifest and collision-free per-page report after every page, write a stable final report, recover unterminated manifests as `ERRORED / error`, and remain queryable from disk after restart or registry eviction. History is newest-first through `GET /api/v1/testing/runs`; retention defaults to 14 days; artifact totals include the retained run directory and warn above 1 GB. Routine screenshots are viewport JPEG q70, failure evidence may be full-page, traces retain only when a matrix target has findings, and contexts recycle with `storageState` every 50 pages.

The stream retains 2,000 lightweight events and terminal buffers for 10 minutes, replays after `?lastSequence=N`, uses application heartbeats, follows `run.completed → run.report_ready → 2s → 1000/run_complete`, and falls back to 10-second polling during capped exponential reconnects. Disk-backed run snapshots prevent `run.not_found` for retained history. Backend/frontend contracts, OpenAPI, and both README event tables were updated in the same implementation.
