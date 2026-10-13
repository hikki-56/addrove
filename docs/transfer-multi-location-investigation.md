# Transfer approval across multiple source locations

Production testing on 2026-10-13 found that receipt-derived products with stock
on several shelves could be submitted for transfer but failed approval. The
worker workflow scans the product and destination, leaving `source_allocations`
empty. The stored source location was a display string such as
`1K14-1A, 1K14-1B`, which PostgreSQL cannot resolve as one location.

The PostgreSQL stock repository now allocates a warehouse-wide transfer against
current positive balances when no explicit source allocations were supplied.
It prefers the recorded source shelves, then other active source locations,
including unassigned stock. Allocation runs inside the approval transaction.
Each deduction uses an actual location ID and the completed document retains
the allocations. Explicit allocations continue through the existing path.

Regression verification covers three source balances (3 + 2 + 1), transfer of
all six pieces, insufficient-stock rollback and approval replay without adding
movements again. Four related suites passed 61 tests; typecheck, targeted lint
and the production build passed.

Live test receipt: `TRF-20261013-000680`, test product
`ทดสอบ-20261013-01`, warehouse 1 to warehouse 2 at `2K11-1A`, six pieces.
Wrong product barcodes and destination locations from the wrong warehouse were
blocked. Submission moved the task out of the picking queue to waiting approval
without posting stock. The initial failed approval preserved the document and
all balances. Evidence is stored locally in the ignored
`data/transfer-test-2026-10-13/` directory.

After deploying the fix, the same live document completed successfully. Warehouse
1 fell from six pieces to zero: three deducted from `1K14-1A`, two from `1K14-1B`
and one from unassigned stock. Warehouse 2 received six at `2K11-1A`. The ledger
contains exactly three `TRANSFER_OUT` entries and one `TRANSFER_IN`. All other
test product balances were unchanged.

The live transfer history showed the transfer as completed and the Express issue
queue contained one row for the same document, SKU and six-piece quantity. Its
status remains pending external Express import. This test used barcode text
entry rather than physical scanner or camera hardware.
