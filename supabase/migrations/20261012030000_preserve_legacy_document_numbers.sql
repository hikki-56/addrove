-- Historical sheets contain duplicate business numbers with distinct document
-- IDs. Preserve them; enforce uniqueness on all newly-created documents.
alter type stockify_document_status add value if not exists 'IN_PROGRESS';
alter table documents add column if not exists migrated boolean not null default false;
alter table documents drop constraint if exists documents_no_unique;
create unique index if not exists documents_new_no_unique on documents(document_no) where migrated=false;
create index if not exists documents_no_lookup_idx on documents(document_no,source_row);
