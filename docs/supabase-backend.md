# Supabase backend handoff

Updated 19 November 2026. The Phase 3 authenticated slice is implemented: password login, server-backed case selection and commands, real private uploads, focused client proposals and account-change cleanup. The normal Vite build uses Supabase; the previous local simulation is isolated behind an explicit test build flag. The Supabase API is deployed. Publishing this frontend revision to Vercel remains a separate step.

## Deployed foundation

- Project: `rekonvia-db`, Singapore (`ap-southeast-1`).
- Repository-local Supabase CLI, linked to the verified project.
- Versioned migration in `supabase/migrations/` with RLS on every application table.
- Private `renewal-documents` bucket; no direct authenticated upload, download or list policies.
- Authenticated `renewal-api` Edge Function. Every request except CORS preflight verifies the bearer token through Supabase Auth. Platform JWT verification is disabled deliberately because verification happens inside the function; a publishable key alone is rejected.
- Canonical case JSON, workspace membership and client assignments. Broker snapshots and explicitly allowlisted client proposals live in separate tables.
- An atomic service-only command RPC, immutable history, actor/case-scoped idempotency receipts and optimistic version checks.
- Upload reservation, immutable signed upload paths, server validation, SHA-256 attribution and transactional finalization. Pending uploads cannot satisfy source requirements or be downloaded as evidence.
- Broker-only QS/DFS Word generation in the hosted Edge runtime. Proposal Word generation belongs to Phase 4.

The pure domain, decimal calculations and Word builders live in `supabase/functions/_shared/`. Browser-facing `src/domain.ts` and `src/decimal.ts` re-export the same implementation; `src/downloads.ts` keeps only browser download and summary behavior. Do not create a second server copy of the rules.

## Owner setup and next steps

The four owner-created users and confirmed emails have been verified. Both brokers belong to the same fictional brokerage. Client 1 is assigned only to `PILOT-PAR-2027-001`; Client 2 is assigned only to `PILOT-PAR-2027-002`. The Site URL is correct and public signup remains disabled. No more manual Supabase setup is needed for this slice. No account passwords were read or changed.

1. Run `npm.cmd run dev` locally and sign in with your pilot account. Brokers can open both fictional cases. A client sees no case until its assigned proposal is published; that empty state is expected.
2. In Vercel, set `VITE_SUPABASE_URL` to **`https://watvbzvpkclcqaogyjtb.supabase.co`**, and set `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable key from your local configuration. Keep `VITE_DEMO_MODE` absent or false. Never add the PAT, database password or server key.
3. Deploy the repository changes to Vercel when ready. The existing deployed interface does not change merely because the backend or local files changed. No Git commit, push or Vercel deployment was performed by this implementation.
4. Try the real pilot accounts in separate browser profiles. Use fictional sources, publish each case's proposal, then sign in as its assigned client. Account recovery remains owner-assisted while SMTP is deferred.

The browser test has already exercised two brokers and two clients using separate temporary QA accounts, including the full current DFS export. The temporary accounts are disabled after testing and are not your owner-created pilot users.

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

No OpenRouter key is needed now. Add it in Phase 5 after authenticated manual workflows and all three export templates pass acceptance.

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
| `GET /cases/:caseId` | Full broker case or separately constructed client-safe view |
| `POST /cases/:caseId/commands` | Shared-domain command, atomic save and role checks |
| `POST /cases/:caseId/uploads/start` | Broker reserves an existing source version and receives an immutable signed upload URL |
| `POST /cases/:caseId/uploads/:documentId/finalize` | Verify the uploaded bytes; attach the file/hash to canonical state atomically |
| `POST /cases/:caseId/documents/:documentId/download` | Short-lived link for authorized finalized evidence |
| `POST /cases/:caseId/exports` | Broker-only guarded QS or DFS export and immutable manifest |

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

Identical retries return the original result before checking the now-stale save version; changing a request while reusing its key returns 409. A new stale command also returns 409. The UI must retain the unsaved draft, reload current state and let the person review before submitting a new command/key. A replayed original result can be older than the latest case; fetch current state afterward.

File flow:

1. Record source metadata with `addDocument`, or select an existing source version that has no attached file.
2. Start upload with `{ documentVersionId, name, byteSize, mimeType }`.
3. Upload to the returned signed path/token with `upsert: false` and the declared MIME type.
4. Finalize with `{ expectedVersion, idempotencyKey, sha256 }`. The UI supplies the selected file's hash; the server independently validates the actual bytes and rejects a mismatch before attachment. The hash is optional for older API callers. On a save conflict, retain the pending upload and review the latest case before retrying with a new version/key.
5. Only a finalized file can satisfy source requirements for quotations, insurer responses, publication, DFS or binding evidence. Initial simulation metadata does not prove an uploaded file exists.

Reservations expire after two hours and cannot replace finalized bytes. An expired or incompatible reservation requires a new source document version. Signed upload URLs are capabilities; keep them private. Authorized download URLs expire after 60 seconds. Changing a document's client sharing flag through the browser is unavailable; explicit, versioned sharing UX remains to implement.

Exports accept `{ kind: "QS" | "DFS", expectedVersion, idempotencyKey }`. They recheck readiness and verified sources before generation and again at the atomic state commit. A concurrent change prevents publication and the private unfinished object is removed where possible. Successful exports return a signed download link and remain attributed to their original snapshot. Identical successful export retries may retrieve that original artifact even after a later material edit.

Errors: 401 missing/invalid session; 403 disallowed role/origin; 404 missing or inaccessible case/document; 409 stale save/key reuse; 413 oversized request; 415 wrong request content type; 422 invalid command, file or workflow blocker. Unexpected internal errors expose no database details.

## Verification and limits

Run local checks:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:brand
npm.cmd run test:e2e
```

The final backend regression passed 67 hosted checks. All 59 local tests, 14 isolated-simulation Chromium tests and the full four-account authenticated browser journey passed, together with TypeScript/Deno checks, the production build and brand contract. The authenticated visual sweep covered 48 views at six widths: 4,455 text-contrast checks and 636 control-boundary checks passed with no overflow or browser errors. The migration history is up to date.

The authenticated browser test covers private uploads, publication, client confirmation, stale client/broker drafts, exact retries after losing a successful response, separate agreement/instruction, matching, final checks and a current hosted DFS download. ZIP/XML inspection verified Unicode, three editable tables and verbatim original wording. Logout/account switching and expired-session cleanup passed. The test launcher now owns preview directly and restores an authenticated production build after simulation tests.

```powershell
$env:REKONVIA_RUN_HOSTED_BROWSER_TESTS='1'
npm.cmd run test:e2e:auth
```

The hosted test deliberately creates synthetic cases in isolated QA workspaces and four temporary accounts, uploads synthetic PDFs, publishes a proposal, submits client confirmation, races two saves and inspects a generated Word archive:

```powershell
$env:REKONVIA_RUN_HOSTED_TESTS='1'
node scripts/test-supabase.mjs
```

It disables the QA accounts in `finally`. Immutable fictional cases, evidence and audit records are retained for traceability, with case IDs beginning `QA-`. This is a stateful integration test, not a production health check; do not schedule it on every page load or deployment.

File checks support PDF, DOCX, XLSX, JPEG, PNG and WebP up to 10 MiB. Office archives have entry-count, individual expanded-size and total expanded-size limits, actual streaming decompression limits, path checks, main-part checks and rejection of encryption/macros. Image checks establish signatures, not full decoding or sanitization. File inspection is not malware scanning or a full PDF/OOXML validator. Keep this phase restricted to fictional pilot documents.

Remaining work includes explicit sharing commands, abandoned-upload/export cleanup, source extraction/segment population, complete three-template exports and production recovery/SMTP. Authentication, server persistence, upload UI and browser acceptance are implemented. AI run storage is deferred until Phase 5; no AI execution or API key has been added.
