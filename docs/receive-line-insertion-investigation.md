# Receive confirmation follows the product when a row is inserted

## Problem and fix

Confirming a receive line and then scanning a different product inserted the new
product at index 0 without shifting the index-based confirmation and location
input state. The new product appeared confirmed while the previously confirmed
product became active again. The same risk existed for selection and insertion
of a separate location row.

All three insertion paths now use `insertLine`, which shifts both UI state maps
alongside the form rows. Newly inserted rows require their own location, quantity
and confirmation.

## Verification on 2026-10-13

- Three regression tests reproduced the bug before the fix and passed afterward.
- Receive approval, Express and Postgres checks: 36 tests passed across three suites.
- Typecheck, targeted lint and production build passed. Lint retains the existing
  React Hook Form compiler compatibility warning.
- Production receipt `RCV-20261013-009046` was created through the UI using test
  products 01, 02 and 03 in warehouse 1: eight pieces across four allocations.
- A second scan of product 01 increased its box count without creating another
  product row or changing its allocated five pieces.
- Before approval the receipt was `PENDING` and all test stock remained unchanged.
- After UI approval it was `POSTED`, with exactly four stock movements: product
  01 received three pieces at `1K14-1A` and two at `1K14-1B`; product 02 received
  two at `1K14-1A`; product 03 received one at `1K14-1A`.
- Including the previous one-piece opening stock, final quantities were 6, 3 and
  2 respectively. Products 04–10 remained at one each.
- Receive history showed the approved receipt and all four allocations.
- The Express receive queue showed exactly four rows for this receipt with the
  same quantities and locations. Product 01 legitimately occupies two rows for
  its two locations; there are no duplicate allocations. Express status remains
  pending because no import into the external Express program was performed.

The test used barcode text entry through the production UI. It does not establish
physical camera or scanner hardware compatibility. Test evidence and before/
after database captures are kept in the ignored `data/receive-test-2026-10-13/`
directory.
