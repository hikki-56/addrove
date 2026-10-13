# Express receipt displayed twice — 13 October 2026

The reported receipt `RCV-20261013-009045` appears twice in the Express receive table with the same SKU, barcode and name. Read-only production queries found one POSTED document, one RECEIVE movement for +1, and one auxiliary Express row. The receipt has not posted stock twice.

The document stores location code `1K14-1A`; the auxiliary Express row stores native location ID `loc-a1`. The locations master proves they identify the same location in `wh-01`. GET `/api/express-import/receive` merged document and Express rows by document number, SKU, location string and quantity. Different representations of the same location failed that match, emitting both sources.

The endpoint now resolves location IDs and codes through the locations master, scoped by warehouse, before display and matching. Semantic matching includes warehouse and consumes one matching Express row per document allocation. Genuine repeated allocations, different locations, different quantities and different warehouses remain distinct. Explicit `A1` is preserved instead of being replaced by a catalog location.

The original failure was reproduced with the reported SKU/barcode/quantity and location pair: two displayed rows before the fix, one after. Regression coverage also preserves split allocations, equal location codes across warehouses, explicit A1, partial Express writes, document fallback, approval idempotency and per-item statuses. Both targeted suites passed (33 tests); TypeScript and scoped ESLint passed. No production stock or document data was modified for this investigation.

Published as `dpl_AsUgYsPi8MXCZCDaDv7BJwx2br4T`. The production alias `addrove.vercel.app` was verified READY; health at 2026-10-13T02:14:09.101Z returned HTTP 200, HEALTHY and postgres CONNECTED. A final read-only check still found one receipt document, one movement for +1, and one auxiliary Express row.
