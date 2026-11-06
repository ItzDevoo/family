-- 006_memories.sql — photos & videos in folders. Originals are plugin files
-- (storage.file:self); a small JPEG thumbnail lives in the row so browsing
-- the grid never spends file-download rate limit.

CREATE TABLE albums (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE memories (
  id            TEXT PRIMARY KEY,
  album_id      TEXT,
  filename      TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,
  taken_at      INTEGER NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  original_name TEXT NOT NULL DEFAULT '',
  thumb         TEXT,
  uploaded_by   TEXT NOT NULL,
  uploaded_at   INTEGER NOT NULL
);
CREATE INDEX idx_memories_album ON memories(album_id, taken_at);
CREATE INDEX idx_memories_taken ON memories(taken_at);

-- Who uploaded which file (from the runtime's onFileUploaded), so a member
-- can only add files they uploaded themselves.
CREATE TABLE pending_uploads (
  filename    TEXT PRIMARY KEY,
  uploaded_by TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  at          INTEGER NOT NULL
);
