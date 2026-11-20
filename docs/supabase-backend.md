# Supabase backend handoff

Updated 20 November 2026. Phases 4–5 implement the authenticated manual workflow and optional broker-only AI source review: case creation/assignment, historical onboarding, private uploads, focused client proposals, three editable Word templates and recorded binding. The normal Vite build uses Supabase; the previous local simulation is isolated behind an explicit test build flag. The Supabase API and migrations are deployed. Publishing this frontend revision to Vercel remains a separate step. Live AI text passed; live image assistance encountered provider errors/rate limiting and remains unverified.

The latest frontend revisions add English/Indonesian localization, section tabs, a sticky header/context panel and a sidebar account menu. These presentation changes retain the existing Auth, permissions, API and readiness rules; they require no new migration or Supabase dashboard setting.

## Deployed foundation

- Project: `rekonvia-db`, Singapore (`ap-southeast-1`).
- Repository-local Supabase CLI, linked to the verified project.
- Versioned migrations in `supabase/migrations/` with RLS on every application table. The three Phase 4 migrations add service-only case management, correct the assignment activity expression, and require explicit historical policy dates.
- Private `renewal-documents` bucket; no direct authenticated upload, download or list policies.
- Authenticated `renewal-api` Edge Function. Every request except CORS preflight verifies the bearer token through Supabase Auth. Platform JWT verification is disabled deliberately because verification happens inside the function; a publishable key alone is rejected.
- Canonical case JSON, workspace membership and client assignments. Broker snapshots and explicitly allowlisted client proposals live in separate tables.
- An atomic service-only command RPC, immutable history, actor/case-scoped idempotency receipts and optimistic version checks.
- Upload reservation, immutable signed upload paths, server validation, SHA-256 attribution and transactional finalization. Pending uploads cannot satisfy source requirements or be downloaded as evidence.
- Guarded QS, proposal and DFS Word generation in the hosted Edge runtime. QS/DFS stay broker-private; assigned clients receive only an explicitly published proposal artifact through a separately authorized download route.
- Broker-private AI batches, steps, attempt counts and human reviews. The Phase 5 migration adds six service-only functions for source validation, idempotency, workspace budgets/leases and review; AI operations never mutate the renewal case.

The pure domain, decimal calculations and Word builders live in `supabase/functions/_shared/`. Browser-facing `src/domain.ts` and `src/decimal.ts` re-export the same implementation; `src/downloads.ts` keeps only browser download and summary behavior. Do not create a second server copy of the rules.

## Owner setup and next steps

The four owner-created users and confirmed emails have been verified. Both brokers belong to the same fictional brokerage. Client 1 is assigned only to `PILOT-PAR-2027-001`; Client 2 is assigned only to `PILOT-PAR-2027-002`. The Site URL is correct and public signup remains disabled. No more manual Supabase setup is needed for this slice. No account passwords were read or changed.

1. Run `npm.cmd run dev` locally and sign in with your pilot account. Brokers can open both fictional cases. A client sees no case until its assigned proposal is published; that empty state is expected.
2. Vercel frontend Config variables are owner-confirmed as added: `VITE_SUPABASE_URL` must be **`https://watvbzvpkclcqaogyjtb.supabase.co`** and `VITE_SUPABASE_PUBLISHABLE_KEY` the publishable key. Apply them to the intended deployment environment; keep `VITE_DEMO_MODE` absent or false. Never add the PAT, database password or server key.
3. Deploy the repository changes to Vercel when ready. The existing deployed interface does not change merely because the backend or local files changed. No Git commit, push or Vercel deployment was performed by this implementation.
4. Try the real pilot accounts in separate browser profiles. Use fictional sources, publish each case's proposal, then sign in as its assigned client. Account recovery remains owner-assisted while SMTP is deferred.

Browser acceptance exercises two brokers and two clients using separate temporary QA accounts, including new-case preparation, all three Word outputs and recorded binding acknowledgment. The temporary accounts are disabled after testing and are not your owner-created pilot users.

For additional existing Auth users, provision a fictional membership and assignment with:

   ```powershell
   node scripts/provision-pilot.mjs --broker BROKER_AUTH_UUID --client CLIENT_AUTH_UUID
   ```

This defaults to `PILOT-PAR-2027-001` and preserves existing case state. For a different client case, specify it explicitly:

```powershell
node scripts/provision-pilot.mjs --broker BROKER_2_AUTH_UUID --client CLIENT_2_AUTH_UUID --case PILOT-PAR-2027-002 --client-name "PT Banyu Sentosa (Fiktif)"
```

Do not provision a second client against the default first case unless that shared assignment is intentional. Every broker in this workspace can access its cases. Do not add users from another brokerage to it. Create additional confirmed password users directly in Supabase Auth while signup and invitations remain disabled.

The owner creates real pilot accounts. The repository tooling can create membership/assignment records, seed fictional cases, deploy migrations/functions and run backend tests. The temporary QA accounts used during implementation are signed out and banned; they are not your pilot accounts.

The owner-provisioned OPENROUTER_API_KEY Edge Function secret is configured and used only by the authenticated server. No further key setup is required. It must never be added to frontend variables. Read the [AI guide](ai-assistance.md) before testing with fictional sources; free-route availability and model accuracy are separate from technical acceptance.

## Navigate the current interface

English is the default. The header's **EN / ID** toggle changes application labels, date/number formatting and the two built-in quotation option names (**Main option / Separate alternative**; **Opsi utama / Alternatif terpisah** in Indonesian). The preference is saved locally; changing it does not rewrite source wording, evidence or case data. Document templates are not selected by the interface language.

The desktop sidebar contains the five broker workflow stages. Horizontal tabs below the case heading select a section within the stage:

| Broker stage | Sections |
| --- | --- |
| Renewal materials | QS overview; Document sources; Wording; Terms & premium; AI assistance; Case access |
| Insurer review | Panel overview; Record response; Wording; Terms & premium |
| Client proposal | Published proposal, publication and proposal Word download in one view |
| Data reconciliation | One tab per location |
| Final review & binding | DFS readiness; Binding; Session notes |

Use **Document sources** for uploads and **Case access** to assign existing client accounts. Insurers remain external parties; brokers record their responses under **Insurer review → Record response**. There is no insurer login or role picker in the authenticated workflow.

Assigned clients have their own restricted workspace with **Proposal**, **Location data**, **Renewal decisions** and **Response history** tabs. Confirm current-period locations before recording proposal acceptance and renewal instruction as separate actions. Client responses remain subject to the existing version and readiness checks.

Tabs and language changes retain unsaved form entries in the current workspace. They do not save them to the server. Save before leaving; workflow-stage and case navigation guard unsaved manual forms, and reload/conflict handling retains drafts for review. AI preparation has its own memory-only limits, described in the [AI guide](ai-assistance.md#interrupted-work-and-failures).

Select your email/role card below the desktop sidebar footer for **Case list** or **Sign out**. On narrow screens, expand the stage navigation (broker) or **Account menu** (case list/client), then open the identity card. The case list itself offers **Sign out**, without a redundant **Case list** action. The header stays visible while scrolling; the broker readiness/activity context stays beside the form on wide screens and returns to normal document flow on smaller screens.

## Local credentials and commands

`.env.local` contains only frontend configuration: the Supabase base URL and publishable key shown in `.env.example`. The original local URL included `/rest/v1/`; this was corrected to the project origin after a browser sign-in test found it routing Auth requests to PostgREST. The Vite build now rejects that path and refuses server credentials in the public key field. `.env.supabase.local` contains the project-scoped `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. An `sb_secret_` key is not a CLI access token. Both local files are Git-ignored.

The CLI wrapper checks the project name, reference and region before hosted operations, loads credentials without echoing them, redacts command output and confines CLI state to this repository. The admin helper retrieves the project service credential into process memory; it never writes it into frontend environment variables or files. The PAT expires after the owner's configured 30 days; renew it locally when needed.

```powershell
node scripts/supabase.mjs verify
node scripts/verify-supabase.mjs
node scripts/supabase.mjs db push --remote --skip-vault --dry-run
node scripts/supabase.mjs db push --remote --skip-vault --yes
node scripts/supabase.mjs functions deploy renewal-api --use-api --yes
```

CLI v3 defaults database commands to the local database. Keep `--remote` for hosted migrations. Do not run `config push`: the generated local configuration is not an instruction to overwrite all existing dashboard settings. Migrations explicitly grant service access and revoke browser writes, independent of automatic table grant settings. Never use `--prune` without checking other deployed functions.

## API contract

All routes below are relative to `/functions/v1/renewal-api`. Send `apikey: <publishable key>` and `Authorization: Bearer <signed-in user's access token>`. JSON mutations require `Content-Type: application/json`.

| Route | Behavior |
| --- | --- |
| `GET /cases` | RLS-filtered broker cases and assigned published client proposals |
| `GET /case-setup` | Broker-only workspace/client directory; no global Auth directory |
| `POST /cases` | Atomically create a fictional case from explicit historical periods/schedule and assign existing clients |
| `GET /cases/:caseId` | Full broker case or separately constructed client-safe view |
| `GET /cases/:caseId/assignments` | Broker-only same-workspace client accounts and current assignments |
| `POST /cases/:caseId/assignments` | Versioned, audited assignment update; protects contributing clients and completed binding |
| `POST /cases/:caseId/commands` | Shared-domain command, atomic save and role checks |
| `POST /cases/:caseId/uploads/start` | Broker reserves an existing source version and receives an immutable signed upload URL |
| `POST /cases/:caseId/uploads/:documentId/finalize` | Verify the uploaded bytes; attach the file/hash to canonical state atomically |
| `POST /cases/:caseId/documents/:documentId/download` | Short-lived link for authorized finalized evidence |
| `POST /cases/:caseId/exports` | Broker-only guarded QS, proposal or DFS export and immutable manifest |
| `POST /cases/:caseId/proposals/:proposalId/document` | Broker or assigned client retrieves an existing published proposal artifact; no private manifest |
| `GET /cases/:caseId/ai` | Broker-private source selections, persisted AI steps, reviews and workspace budget |
| `GET /cases/:caseId/ai/provider-status` | Broker-only sanitized OpenRouter key/account status, without inference |
| `POST /cases/:caseId/ai/batches` | Persist selected finalized-source excerpts/pages without calling AI |
| `POST /cases/:caseId/ai/batches/:batchId/steps/:index` | Execute one pending step under workspace budget/concurrency limits, or return its terminal result |
| `POST /cases/:caseId/ai/batches/:batchId/steps/:index/review` | Attributed human review/dismissal, separate from canonical renewal facts |

Command envelope:

```json
{
  "caseId": "PILOT-PAR-2027-001",
  "expectedVersion": 0,
  "idempotencyKey": "a6446eba-768c-4be1-8188-6338cb6345c3",
  "type": "saveNotes",
  "payload": { "notes": "Fictional pilot note" }
}
```

Role and actor ID come from Auth and database membership, never request fields or editable user metadata. Client actions are `submitLocations`, `clientAgree` and `clientInstruct`. Insurers remain external parties recorded by brokers.

Case creation accepts exactly `{ workspaceId, caseId, clientName, periodStart, periodEnd, priorPeriodStart, priorPeriodEnd, historicalLocations, clientUserIds, idempotencyKey }`. Each historical location is `{ name, address, sumInsured: { amount: "1000000.25", currency: "IDR" } }`; 1–100 rows are supported. Historical dates must precede renewal. Amounts remain exact decimal strings. New cases start with no documents, wording or approvals; broker-entered history cannot establish current client confirmation. Record source versions, add baseline wording and review it before preparing QS.

Assignment updates accept `{ expectedVersion, idempotencyKey, clientUserIds }`, with at most 20 different existing same-workspace client accounts. A client who has supplied evidence or consent cannot be removed through this flow; owner-assisted access review is required. Binding completion locks assignment changes. Each successful creation/access change has an audit event and retry receipt. Browser callers cannot execute these service-only RPCs directly or administer Auth users.

Published proposal downloads use an empty JSON body and return only `{ url, expiresIn, proposalId }`. A client cannot generate a document or download QS/DFS. Historical published proposal artifacts remain historical after material edits; new exports require current readiness. The client screen labels a stale proposal and prevents using it for new agreement/instruction.

Identical retries return the original result before checking the now-stale save version; changing a request while reusing its key returns 409. A new stale command also returns 409. The UI must retain the unsaved draft, reload current state and let the person review before submitting a new command/key. A replayed original result can be older than the latest case; fetch current state afterward.

File flow:

1. Record source metadata with `addDocument`, or select an existing source version that has no attached file.
2. Start upload with `{ documentVersionId, name, byteSize, mimeType }`.
3. Upload to the returned signed path/token with `upsert: false` and the declared MIME type.
4. Finalize with `{ expectedVersion, idempotencyKey, sha256 }`. The UI supplies the selected file's hash; the server independently validates the actual bytes and rejects a mismatch before attachment. The hash is optional for older API callers. On a save conflict, retain the pending upload and review the latest case before retrying with a new version/key.
5. Only a finalized file can satisfy source requirements for quotations, insurer responses, publication, DFS or binding evidence. Initial simulation metadata does not prove an uploaded file exists.

Reservations expire after two hours and cannot replace finalized bytes. An expired or incompatible reservation requires a new source document version. Signed upload URLs are capabilities; keep them private. Authorized download URLs expire after 60 seconds. Raw source documents remain broker-private in the current UI. Published proposal Word downloads use a separate explicit publication/assignment check; they never expose the raw broker file or private export manifest.

Exports accept `{ kind: "QS" | "proposal" | "DFS", expectedVersion, idempotencyKey }`. QS requires a reviewed current quote; proposal requires a current published proposal and compatible panel; DFS additionally requires current client confirmations, agreement, instruction, matching, checks and resolved required conditions. They recheck readiness and verified sources before generation and again at the atomic state commit. A concurrent change prevents publication and the private unfinished object is removed where possible. Successful exports return a signed download link and remain attributed to their original snapshot. Identical successful export retries may retrieve that original artifact even after a later material edit.

Errors: 401 missing/invalid session; 403 disallowed role/origin; 404 missing or inaccessible case/document; 409 stale save/key reuse; 413 oversized request; 415 wrong request content type; 422 invalid command, file or workflow blocker. Unexpected internal errors expose no database details.

## Verification and limits

Run local checks:

```powershell
npm.cmd run test:e2e:install
npm.cmd test
npm.cmd run build
npm.cmd run test:brand
npm.cmd run test:e2e
```

Recorded Phase 4 backend acceptance passed 89 workflow/export checks, 36 case-management checks and both authenticated browser journeys, together with TypeScript/Deno checks and migration verification. Its visual sweep covered 66 views at six widths, including 6,175 rendered-text and 780 control-boundary contrast checks. These are historical results for that implementation, rather than a new hosted run of the latest UI. The current local browser suite also checks localization, section navigation, retained drafts, keyboard focus, account menus, responsive overflow and sticky positioning using deterministic mocked authenticated responses. Detailed dated execution evidence is recorded in the private implementation plan.

Hosted authenticated browser tests cover new-case creation from exact historical periods/schedules, assignment add/remove, real baseline authoring/uploads, publication and client-safe proposal downloads, stale client/broker drafts, exact retries after losing a successful response, separate agreement/instruction, matching, final checks and recorded manual binding. During recorded acceptance, all three hosted Word archives were downloaded and inspected; ZIP/XML checks verified Unicode, editable tables, verbatim wording and separate amendments. Logout/account switching and expired-session cleanup passed. The test launcher owns preview directly and restores an authenticated production build after local simulation/mocked-account tests.

```powershell
$env:REKONVIA_RUN_HOSTED_BROWSER_TESTS='1'
npm.cmd run test:e2e:auth
```

The hosted test deliberately creates synthetic cases in isolated QA workspaces and four temporary accounts, uploads synthetic PDFs, publishes a proposal, submits client confirmation, races two saves and inspects a generated Word archive:

```powershell
$env:REKONVIA_RUN_HOSTED_TESTS='1'
node scripts/test-supabase.mjs
node scripts/test-case-management.mjs
node scripts/verify-supabase.mjs
```

It disables the QA accounts in `finally`. Immutable fictional cases, evidence and audit records are retained for traceability, with case IDs beginning `QA-`. This is a stateful integration test, not a production health check; do not schedule it on every page load or deployment.

File checks support PDF, DOCX, XLSX, JPEG, PNG and WebP up to 10 MiB. Office archives have entry-count, individual expanded-size and total expanded-size limits, actual streaming decompression limits, path checks, main-part checks and rejection of encryption/macros. Image checks establish signatures, not full decoding or sanitization. File inspection is not malware scanning or a full PDF/OOXML validator. Keep this phase restricted to fictional pilot documents.

Phase 5 adds four RLS-protected AI tables and six service-only functions through `20261119200000_ai_assistance.sql`, with source-segment provenance distinguishing browser inputs from manual citations. The authenticated `renewal-api` uses the owner-provisioned `OPENROUTER_API_KEY` Edge Function secret. The [AI guide](ai-assistance.md) documents local preparation, exact request bounds, free-only/private routing, resume semantics and verification. AI results/reviews never update canonical renewal state. Post-deployment hardening checks verify all 17 public tables have RLS, service-only command/setup/AI functions, private Storage and disabled signup.

Raw-source sharing beyond published proposals, abandoned-upload/export cleanup and production recovery/SMTP remain deferred. The manual lifecycle, all three Word templates and optional AI assistance are implemented. Researcher-led usability testing and desktop Microsoft Word rendering remain unperformed.
