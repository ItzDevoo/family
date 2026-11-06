// Memories: folders of photos & videos. Storage + validation; handlers in
// index.ts. Thumbnails are small data-URL JPEGs made on the uploading device.

import type { Db } from "./store";

export interface Album {
  id: string;
  name: string;
  note: string;
  count: number;
  coverId: string | null;
  latest: number | null;
}

export interface Memory {
  id: string;
  albumId: string | null;
  filename: string;
  kind: "photo" | "video";
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  takenAt: number;
  caption: string;
  originalName: string;
  uploadedBy: string;
  uploadedAt: number;
  hasThumb: boolean;
}

/** Server-chosen filenames are `<uuid>.<ext>` from the sniffed type. */
const PHOTO_EXT = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "avif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);
const FILENAME_RE = /^[A-Za-z0-9_-]{8,80}\.([a-z0-9]{2,5})$/;

export function kindForFilename(filename: string): "photo" | "video" | null {
  const m = FILENAME_RE.exec(filename);
  if (!m) return null;
  const ext = m[1]!.toLowerCase();
  if (PHOTO_EXT.has(ext)) return "photo";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

/** Thumbnails must be small JPEG/WebP data URLs (≤ 60 KB of text). */
export const MAX_THUMB_CHARS = 60_000;
export function validThumb(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_THUMB_CHARS) return null;
  return /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;
}

// ---------------------------------------------------------------------------

interface MemoryRow {
  id: string;
  album_id: string | null;
  filename: string;
  kind: "photo" | "video";
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  taken_at: number;
  caption: string;
  original_name: string;
  uploaded_by: string;
  uploaded_at: number;
  has_thumb: number;
}

const COLS = `id, album_id, filename, kind, mime, size, width, height, duration_ms, taken_at, caption,
  original_name, uploaded_by, uploaded_at, (thumb IS NOT NULL) AS has_thumb`;

const toMemory = (r: MemoryRow): Memory => ({
  id: r.id,
  albumId: r.album_id,
  filename: r.filename,
  kind: r.kind,
  mime: r.mime,
  size: r.size,
  width: r.width,
  height: r.height,
  durationMs: r.duration_ms,
  takenAt: r.taken_at,
  caption: r.caption,
  originalName: r.original_name,
  uploadedBy: r.uploaded_by,
  uploadedAt: r.uploaded_at,
  hasThumb: r.has_thumb === 1,
});

export async function listAlbums(db: Db): Promise<Album[]> {
  const rows = await db.query<{ id: string; name: string; note: string; count: number; cover_id: string | null; latest: number | null }>(
    `SELECT a.id, a.name, a.note,
       (SELECT COUNT(*) FROM memories m WHERE m.album_id = a.id) AS count,
       (SELECT m.id FROM memories m WHERE m.album_id = a.id AND m.thumb IS NOT NULL ORDER BY m.taken_at DESC LIMIT 1) AS cover_id,
       (SELECT MAX(m.taken_at) FROM memories m WHERE m.album_id = a.id) AS latest
     FROM albums a WHERE a.archived = 0 ORDER BY COALESCE(latest, a.created_at) DESC`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, note: r.note, count: r.count, coverId: r.cover_id, latest: r.latest }));
}

export async function albumExists(db: Db, id: string): Promise<boolean> {
  return (await db.query<{ id: string }>("SELECT id FROM albums WHERE id = ? AND archived = 0", [id])).length > 0;
}

export async function saveAlbum(db: Db, a: { id: string; name: string; note: string }, by: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO albums (id, name, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, note = excluded.note`,
    [a.id, a.name, a.note, by, now],
  );
}

/** Removing a folder keeps its photos (they move to "no folder"). */
export async function archiveAlbum(db: Db, id: string): Promise<void> {
  await db.run("UPDATE albums SET archived = 1 WHERE id = ?", [id]);
  await db.run("UPDATE memories SET album_id = NULL WHERE album_id = ?", [id]);
}

export async function listMemories(
  db: Db,
  /** `before` is the last item of the previous page; ties on taken_at fall back to id. */
  opts: { albumId: string | null | "all"; before: { takenAt: number; id: string } | null; limit: number },
): Promise<Memory[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.albumId !== "all") {
    if (opts.albumId === null) where.push("album_id IS NULL");
    else { where.push("album_id = ?"); params.push(opts.albumId); }
  }
  if (opts.before !== null) {
    where.push("(taken_at < ? OR (taken_at = ? AND id < ?))");
    params.push(opts.before.takenAt, opts.before.takenAt, opts.before.id);
  }
  const sql = `SELECT ${COLS} FROM memories ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY taken_at DESC, id DESC LIMIT ?`;
  params.push(opts.limit);
  return (await db.query<MemoryRow>(sql, params)).map(toMemory);
}

export async function getMemory(db: Db, id: string): Promise<Memory | null> {
  const r = (await db.query<MemoryRow>(`SELECT ${COLS} FROM memories WHERE id = ?`, [id]))[0];
  return r ? toMemory(r) : null;
}

export async function memoryByFilename(db: Db, filename: string): Promise<boolean> {
  return (await db.query<{ id: string }>("SELECT id FROM memories WHERE filename = ?", [filename])).length > 0;
}

/** Thumbnails for up to `ids.length` items, capped by total size. */
export async function thumbs(db: Db, ids: string[], maxChars = 1_500_000): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await db.query<{ id: string; thumb: string | null }>(
    `SELECT id, thumb FROM memories WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const out: Record<string, string> = {};
  let total = 0;
  for (const r of rows) {
    if (!r.thumb) continue;
    if (total + r.thumb.length > maxChars) break;
    total += r.thumb.length;
    out[r.id] = r.thumb;
  }
  return out;
}

export async function insertMemory(db: Db, m: Memory & { thumb: string | null }): Promise<void> {
  await db.run(
    `INSERT INTO memories (id, album_id, filename, kind, mime, size, width, height, duration_ms, taken_at, caption,
       original_name, thumb, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.id, m.albumId, m.filename, m.kind, m.mime, m.size, m.width, m.height, m.durationMs, m.takenAt, m.caption,
      m.originalName, m.thumb, m.uploadedBy, m.uploadedAt],
  );
}

export async function updateMemory(db: Db, id: string, albumId: string | null, caption: string): Promise<void> {
  await db.run("UPDATE memories SET album_id = ?, caption = ? WHERE id = ?", [albumId, caption, id]);
}

export async function deleteMemoryRow(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM memories WHERE id = ?", [id]);
}

export async function stats(db: Db): Promise<{ count: number; bytes: number; photos: number; videos: number }> {
  const r = (await db.query<{ count: number; bytes: number | null; photos: number; videos: number }>(
    `SELECT COUNT(*) AS count, SUM(size) AS bytes, SUM(kind = 'photo') AS photos, SUM(kind = 'video') AS videos FROM memories`,
  ))[0];
  return { count: r?.count ?? 0, bytes: r?.bytes ?? 0, photos: r?.photos ?? 0, videos: r?.videos ?? 0 };
}

export async function notePendingUpload(db: Db, f: { filename: string; uploadedBy: string; mimeType: string; size: number }, now: number): Promise<void> {
  await db.run(
    `INSERT INTO pending_uploads (filename, uploaded_by, mime, size, at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(filename) DO NOTHING`,
    [f.filename, f.uploadedBy, f.mimeType, f.size, now],
  );
}

/**
 * Upload records stay until the file becomes a memory (the row is dropped on
 * add) or a day passes. Stale ones that never became a memory are orphans the
 * sweep deletes from storage.
 */
export async function stalePendingUploads(db: Db, before: number): Promise<{ filename: string; orphan: boolean }[]> {
  const rows = await db.query<{ filename: string; used: number }>(
    `SELECT p.filename, EXISTS (SELECT 1 FROM memories m WHERE m.filename = p.filename) AS used
     FROM pending_uploads p WHERE p.at < ? LIMIT 50`,
    [before],
  );
  return rows.map((r) => ({ filename: r.filename, orphan: r.used !== 1 }));
}

export async function dropPendingUpload(db: Db, filename: string): Promise<void> {
  await db.run("DELETE FROM pending_uploads WHERE filename = ?", [filename]);
}

export async function getPendingUpload(db: Db, filename: string): Promise<{ uploadedBy: string; mime: string; size: number } | null> {
  const r = (await db.query<{ uploaded_by: string; mime: string; size: number }>(
    "SELECT uploaded_by, mime, size FROM pending_uploads WHERE filename = ?",
    [filename],
  ))[0];
  return r ? { uploadedBy: r.uploaded_by, mime: r.mime, size: r.size } : null;
}
