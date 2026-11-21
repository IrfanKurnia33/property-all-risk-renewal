# AI source review in Rekonvia

Updated 21 November 2026. **Renewal materials → AI clause review** (**Bahan renewal → Tinjauan klausul AI**) is the broker's entry task. It compares an eligible prior Final Slip with an immutable, finalized workspace Standard T&C version and prepares a cited review queue. Other source-preparation and extraction tools remain available as secondary options. AI does not change the case, accept an amendment, confirm client data, record insurer acceptance or clear readiness checks. Clients cannot access its routes, inputs or results.

The interface defaults to English. Use the header's **EN / ID** toggle to switch languages; the preference is saved in this browser. Source excerpts, original files, AI results and entered evidence retain their original text. The instructions below use the English labels.

## Use the panel

1. Make sure a prior Final Slip has a finalized file in **Document sources**, and that the workspace Superadmin has uploaded and finalized the applicable Standard T&C version in **Workspace settings**. Eligible prior slips must be agreed or issued and end before the current renewal period.
2. Open **AI clause review**. The latest eligible prior slip and latest finalized Standard T&C version are selected by default; confirm both names and versions, or change either selection.
3. Select **Prepare source pair**. The browser downloads the authorized originals, verifies size and SHA-256, then prepares text locally. When the complete text from both files fits the existing section/character limits, it is selected for you. Otherwise, open the relevant sections from both sources and select excerpts manually. This step does not call OpenRouter.
4. For a scan, select its page and orientation, then **Show page preview**. Inspect before selecting. A clause-review group still requires text from both sources; a selected image supplements the text context and does not replace either cited source.
5. Check every selected passage and the displayed omission count. Confirm that the selection contains only fictional material cleared for external AI processing. **Save selection group** stores the selection without invoking a model.
6. Select **Process step** for each pending step explicitly. Each finding must cite selected sections from both source families and use one of five statuses: new/strengthened, removed, modified, unchanged or unresolved. Image steps contain one image and selected text context; comparisons between image pages remain unsupported.
7. Check every finding against both cited originals. The copy action copies a selected source excerpt verbatim; AI-proposed wording remains read-only. For each finding, record **Accept as a draft candidate**, **Reject suggestion** or **Follow up**, with a note. These immutable review records do not change case wording or canonical renewal state; acceptance is not approval. Record any resulting renewal decision through the existing manual forms.

Per-finding decisions concern the AI suggestion only. They do not establish that a quotation, clause, client confirmation or insurer response is correct. Structurally valid citations do not prove factual accuracy. Browser-prepared excerpts are labeled `browser-ai-input`, not independently verified transcriptions. If either source is unavailable, AI is unavailable or the budget is exhausted, continue with Document sources and the manual wording review.

## Limits and coverage

| Boundary | Current limit |
| --- | --- |
| Stored original | 10 MiB; PDF, DOCX, XLSX, JPEG, PNG or WebP |
| Files open for browser preparation | 10; clear browser preparation to release them |
| Local text preparation per file | 200,000 characters and 2,000 sections |
| PDF preparation | First 100 pages; remaining pages explicitly unprepared |
| XLSX preparation | 50 sheets; reject workbooks above 50,000 cell records |
| Selected batch | 40 sections, 40,000 text characters, at most five image pages |
| Clause-review source pair | At least one selected text excerpt from an eligible prior Final Slip and one from a finalized workspace Standard T&C |
| Clause-review finding | One of five clause categories, a recommended next step, and citations from both selected source families |
| Provider request | One text request or one image with selected text context |
| Prepared image | JPEG/PNG, at most 1.5 MB; preview edge at most 1,600 pixels |
| Original raster preparation | At most 25 megapixels before rendering |
| Workspace budget | 40 reserved attempts per UTC day; failures count |
| Concurrency | One running provider request per workspace |
| Provider timeout / interrupted-run lease | 35 seconds / 120 seconds |
| History screen | Latest 50 batches per case; older records remain in the database |

The screen distinguishes prepared text, selected content, unopened files, pending steps, failures and completed suggestions. A completed step is not a completed document review. Omission counts concern locally opened sources and selected units; they are not a measurement of the entire case or hidden content in an Office file.

PDF.js prepares PDF text and renders selected pages. DOCX preparation reads paragraphs, table cells and auxiliary text parts, including headers/footers, with tracked-change and embedded-image warnings. It does not preserve arbitrary Word layout or OCR images inside Word. ExcelJS reads cell coordinates, hidden status, stored formulas and cached results without executing formulas. Numeric spreadsheet values reflect the workbook's stored representation; they are not proof of the original entered decimal or current calculation. Corrupt/unsupported files can require manual review or a simpler re-export.

## Interrupted work and failures

- Inputs, source locators, original hashes, completed results and review annotations are persisted separately from canonical renewal state. Page-image bytes remain in browser memory; the server records a derived-input hash. After reload, reopen the original and reproduce the pending page/orientation before running it.
- Completed and failed steps are terminal. Checking them again returns the existing result without another provider call, including after a lost response. A failed attempt requires an explicitly created new batch if the broker chooses to try again.
- An uncertain network/server result retains the original request envelope. **Check last request** checks that same operation. It does not start an automatic retry loop. If the first invocation still runs, use **Refresh AI status** after it ends. An abandoned running lease becomes `AI_INTERRUPTED` after 120 seconds.
- Quotas, unavailable eligible providers, invalid output, unsupported images, refusals and timeouts retain completed work. Continue with the source inventory, wording comparison and manual lifecycle. AI failure never grants readiness or blocks the normal renewal commands.
- Unsent selections, page previews and review-note drafts are memory-only. Switching tabs within **Renewal materials**, or switching EN / ID, retains them. Save selections and review notes before changing workflow stage, leaving the case, reloading or signing out. Case/account changes clear the private UI; authenticated canonical cases and source content are not written to browser storage.

## Server routing and handling

`OPENROUTER_API_KEY` belongs only in **Supabase Edge Function Secrets**. Do not put it in `.env.local`, any `VITE_` variable, frontend Vercel configuration, source files or browser requests. An owner-added secret is sufficient; no browser credential setup is needed.

The authenticated `renewal-api` verifies the user's JWT, case access and broker membership. Database functions independently recheck membership, serialize workspace reservations, count failed attempts and deduplicate steps. Browser roles cannot execute these functions directly or write AI tables. Case files use the existing authorized download flow; workspace Standard T&C files are signed only for a matching broker workspace and finalized version.

The server fixes the model to `openrouter/free`, requests JSON output and accepts only bounded findings with valid selected-source IDs. Document text/images are untrusted content. No tool execution, client-selected models/providers, paid PDF/OCR plugins, automatic model fallback or automatic retry loop is provided.

Provider routing uses `allow_fallbacks: false`, `require_parameters: true`, `data_collection: 'deny'`, `zdr: true`, and zero maximum prompt/completion/image/request prices. No eligible route means failure, without weakening these controls. Free-router availability and model capabilities vary. See OpenRouter's [free-router guide](https://openrouter.ai/docs/guides/routing/routers/free-router) and [provider controls](https://openrouter.ai/docs/guides/routing/provider-selection).

These are routing filters, not a promise that every service retains nothing. OpenRouter's effective ZDR/safety-retention handling also depends on account and guardrail policy. Keep this pilot fictional; real client or proprietary documents need a separate handling decision. See the [ZDR documentation](https://openrouter.ai/docs/guides/features/zdr).

`GET /cases/:caseId/ai/provider-status` checks the key without inference and returns only configured/available status and sanitized account limits. A valid key does not establish that a compatible free provider is available. The 40-attempt application budget is independent of OpenRouter's account/model limits; absent account-limit fields remain unknown, not unlimited. See the [account-limits endpoint](https://openrouter.ai/docs/api_reference/limits).

## API routes

All routes require the existing `apikey` header and the signed-in broker's bearer token. Paths below are relative to `/functions/v1/renewal-api/cases/:caseId`.

| Route | Behavior |
| --- | --- |
| `GET /ai` | Refresh expired leases; return recent batches, per-step/per-finding reviews, workspace budget and authorized source catalogue |
| `GET /ai/sources/:versionId/download` | Return a short-lived URL and hash/size metadata for one finalized Standard T&C version in this broker's workspace |
| `GET /ai/provider-status` | Read-only key/account status; no inference |
| `POST /ai/batches` | Validate selected finalized sources, save excerpts/locators and pending steps; clause review requires both eligible source families |
| `POST /ai/batches/:batchId/steps/:index` | Reserve budget and execute a pending step once; terminal steps return existing results |
| `POST /ai/batches/:batchId/steps/:index/review` | Add an attributed human review/dismissal; never a canonical case action |
| `POST /ai/batches/:batchId/steps/:index/findings/:findingIndex/review` | Append an idempotent, immutable accepted/rejected/follow-up decision for one completed clause finding |

Batch input is exactly `{ idempotencyKey, purpose: 'extract' | 'compare' | 'clause-review', sections, unprocessedCount }`. Each section has `{ id, documentVersionId, sha256, locator, kind, sourceType }`, plus `text` only for a text section; `sourceType` is `case` or `workspace-standard-terms`. Case hashes must match finalized sources belonging to that case; Standard T&C hashes must match a finalized version in the same workspace. This proves original-source identity; the server does not independently re-extract browser text or prove an image is a faithful derivative.

Execution input is `{ idempotencyKey }`, plus a bounded local JPEG/PNG `imageDataUrl` for a pending image step. Per-step reviews accept `{ idempotencyKey, decision: 'reviewed' | 'dismissed', note }`; clause-finding reviews accept `{ idempotencyKey, decision: 'accepted' | 'rejected' | 'follow-up', note }`. Unknown fields and model/provider overrides are rejected. Expected provider failures return a persisted `failed` step; role, validation, concurrency and budget failures retain their HTTP status.

## Verification

Install Chromium into the repository cache once with `npm.cmd run test:e2e:install`; `npm.cmd test` includes actual-browser parser tests. Run `npm.cmd run build`, `npm.cmd run test:brand` and `npm.cmd run test:e2e` as well. The default browser suite covers the isolated simulation plus mocked authenticated UI, including language/tab draft retention and account navigation; it does not call the hosted backend. PDF.js, its worker and ExcelJS are lazy assets, loaded only for preparation; inspect their actual production output rather than treating the initial application bundle as their cost.

Hosted checks deliberately create isolated fictional QA workspaces and temporary accounts:

```powershell
$env:REKONVIA_RUN_HOSTED_TESTS='1'
node scripts/test-ai.mjs
node scripts/verify-supabase.mjs

$env:REKONVIA_RUN_HOSTED_BROWSER_TESTS='1'
npm.cmd run test:e2e:auth
```

The AI hosted suite tests the 40-attempt cap using database reservations/finishes, without consuming 40 provider requests. It covers permissions, source identity, failed-attempt counting, concurrent brokers, lease expiry, replay and unchanged renewal state. To additionally make at most one synthetic text and one synthetic image inference, set `REKONVIA_RUN_LIVE_AI_TESTS=1` before running it. Browser acceptance uses real stored synthetic DOCX files and local preparation, with deterministic mocked AI success/failure responses; it does not measure live AI accuracy.

A separate readable-image smoke check is available with `REKONVIA_RUN_HOSTED_TESTS=1` and `REKONVIA_RUN_LIVE_AI_VISION_TEST=1`, then `node scripts/test-ai-vision.mjs`. It renders a fictional clause image locally, uploads/finalizes that synthetic original and makes exactly one image request. This is an explicit additional provider call, not an automatic retry of another test.

Tests sign out and disable temporary accounts in `finally`. Immutable QA records remain for traceability. Do not schedule these stateful suites as health checks. The private implementation plan records execution results, live-provider observations and the still-required researcher-led retest.
