# Stockify page unresponsiveness — 2026-10-13

The reported symptom was Chrome's “Page unresponsive” dialog on production, across all pages. A synchronous notification refresh in the shared Sidebar/Navbar path could block JavaScript for almost an entire polling interval.

## Reproduction and fix

The read-only transfer fixture contained 845 documents, including 727 COMPLETED/CANCELLED documents. After seeding the previous successful refresh, the actual notification utility was replayed in Node with in-memory browser storage and two synchronous pending-notification readers representing Sidebar and Navbar. Network and React rendering were excluded.

| One unchanged refresh | Before | After |
| --- | ---: | ---: |
| Synchronous processing | 56,126 ms | 9 ms |
| Storage reads | 573,196 | 3 |
| Storage writes | 1,454 | 0 |
| Subscriber events | 727 | 0 |

`syncServerTransferNotifications` previously called `markTransferCompleted` for every historical completed document on every refresh. Each call rewrote browser storage and synchronously notified UI subscribers. Each notification reader reparsed and scanned the entire completed-ID list for every task. The shared scheduler refreshes on subscription and every 60 seconds, so repeated stalls affected navigation and all dashboard pages.

Completion IDs are now parsed into a Set once per read/batch. Sync collects completions, persists changed history once, merges tasks, and broadcasts once only when the result changes. Pending tasks, document-number matching, case-insensitive IDs, terminal statuses, progress preservation, and rollback remain covered by regression tests. No inventory records or credentials were changed by this fix.

## Other checks

- Production root/login/employee-login returned HTTP 200 in 141–480 ms. All 10 discovered login JavaScript/CSS assets returned HTTP 200 in 196–625 ms.
- Protected Dashboard, products, locations, receive, transfer, and Express receive routes correctly redirected unauthenticated requests to employee-login in 77–108 ms. These are routing/auth boundary checks, not logged-in page rendering checks.
- Production auth/session returned HTTP 200 in 140 ms; system health returned HTTP 200 in 128 ms. Supabase was CONNECTED, and Google Apps Script was skipped for the PostgreSQL driver. A database activity check found no waiting writers or idle transactions.
- Read-only native repository timings: warehouses 566 ms (cold connection), products 335 ms, locations 82 ms, shelves 42 ms, transfer history 214 ms, movement history 246 ms, stock summary 124 ms, dashboard 2,998 ms. These include the local-to-Supabase connection and are not production HTTP latency measurements.
- Reviewed shared auth state/fetch patch, theme, visibility polling, transfer scheduler, production bell, animation hooks, Dashboard table/derived data, product/location effects, receive/transfer workflows, and Express storage subscriptions. No additional common render loop was identified in this review.
- All 845 transfer metadata strings parsed successfully without a slow parser case.
- Regression suite: 55 suites passed, 528 tests passed, 1 skipped. Typecheck and scoped ESLint passed.

## Verification limits

The user's Chrome tab/session was not accessible through the connected browser. The fresh production browser session reached login without console errors. The local browser fixture could not be opened through the in-app browser (connection timeout), so the before/after measurements are utility-level execution, not a claim of full browser rendering performance. Final confirmation on the user's logged-in tab requires loading the deployed version and observing navigation across a polling interval.

## Production release

Deployment `dpl_3fo5sSCXbFPAGAZNxznz2Lj8sDYw` reached READY and was aliased to `https://addrove.vercel.app`. The Vercel production build completed successfully, including TypeScript and all 77 generated pages. The post-release health check returned HTTP 200, HEALTHY, PostgreSQL CONNECTED, and zero environment errors at 2026-10-13 01:42:21 UTC.

## Follow-up: legacy history appearing as picking tasks

The user reported `LEGACY-5b68f97b9736e0cb` and several similar cards in the picking queue. A read-only database check identified 98 TRANSFER documents with status POSTED and metadata kind LEGACY_IMPORT_REFERENCE. Migration created these parent documents only to retain stock-movement references whose original parent document was absent from the source Documents tab.

The reported document links two posted movements from 2026-08-27: TRANSFER_OUT of 500 units from wh-03 and TRANSFER_IN of 500 units to wh-02. The card's 1 unit and wh-01 → wh-02 were fallback values from the notification mapper, not the ledger values. Previously the mapper classified every status other than COMPLETED/CANCELLED/REJECTED as a pending task.

Sync now treats POSTED and legacy reference markers as terminal history, before creating task metadata. Browser-cache reads also exclude legacy reference markers immediately, so stale cards from the previous version do not reappear before polling. The ledger and database document statuses are preserved. Replaying all 845 transfer documents now retains 20 active notifications (12 pending and 8 waiting for approval), instead of 100 capped notifications polluted by history. Unchanged replay took 6 ms, with three reads and no writes/events.

Validation: 15 notification tests and 27 stock-transfer tests passed; typecheck and scoped ESLint passed. Regression tests cover cached legacy cards, POSTED documents, markers with stale PENDING status, and preservation of genuine pending/waiting-approval tasks.

## Follow-up: acknowledged submissions remaining pending

Read-only reconciliation on 13 October found 12 actual pending tasks. Ten have production POST `/submit` logs from 12 October with HTTP 200 and workflow outcome success. Five were served by `dpl_8faU98f4FKT6Uo5noXNxtWwY35bm`, five by `dpl_DeeXuFJQc94PkPz9FDxmiQ88jtCf`. The source Sheets snapshot from 13 October 08:13 Thai time already contained the same PENDING states and notes as Supabase; no corresponding stock movements were found. Do not infer that staff never confirmed from those pending states.

The saved production configuration enabled legacy Apps Script bodies. In the backed-up script, raw `{action: "update", sheetName, rowNumber, values}` selects the direct importer because sheetName exists. That importer only reads rows/data, ignores values and returns success with count zero. An isolated VM reproduction of the backed-up script acknowledged the update while performing zero writes. This is a concrete mechanism consistent with the logs and unchanged source; per-request Apps Script bodies/responses were not retained, so the specific internal path of each historical request cannot be established. Progress errors also show HMAC signature mismatches.

Transfer submission now reads the document back before returning success and rejects a status still pending, including writers whose mutate method returns a constructed success object. The PostgreSQL request transaction commits before its response is delivered. Tests cover no-op acknowledgments for both repository paths, persistence in PostgreSQL, delayed progress and repeat submission without stock postings. Both targeted suites passed (43 tests), with TypeScript and scoped ESLint passing. No live task or stock record was changed to test submission. Destination locations and original submitter details must be confirmed before reconciling the old pending records.

Deployed as `dpl_8opnHNZd4SNBWz96BzHAVBTzZrYp`; production alias verified READY. Public health at 2026-10-13T02:03:57.700Z returned HTTP 200, HEALTHY, postgres CONNECTED and Apps Script SKIPPED.

Follow-up deployment `dpl_7j9g9zhGT8YWoY9xLE4LD4T9DmYs` reached READY and was aliased to `https://addrove.vercel.app` with a successful production build.
