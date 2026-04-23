ALTER TABLE documents ADD COLUMN outline_yjs_state BLOB;

ALTER TABLE transcript_cache ADD COLUMN volume TEXT;
ALTER TABLE transcript_cache ADD COLUMN page_number TEXT;
ALTER TABLE transcript_cache ADD COLUMN collection_title TEXT;
