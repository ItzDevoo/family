import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as mem from "../backend/memories";
import type { Db } from "../backend/store";

function memoryDb(): Db {
  const sqlite = new Database(":memory:");
  const dir = join(import.meta.dir, "..", "migrations");
  for (const m of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(join(dir, m), "utf8"));
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return sqlite.query(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      return { changes: sqlite.query(sql).run(...(params as never[])).changes };
    },
  };
}

const THUMB = "data:image/jpeg;base64,/9j/AAAA";
const photo = (id: string, takenAt: number, albumId: string | null = null, thumb: string | null = THUMB) => ({
  id, albumId, filename: `${id}0000-0000-0000-0000-000000000000.jpg`, kind: "photo" as const, mime: "image/jpeg", size: 1000,
  width: 4032, height: 3024, durationMs: null, takenAt, caption: "", originalName: "IMG.jpg", uploadedBy: "devin",
  uploadedAt: takenAt, hasThumb: false, thumb,
});

describe("what counts as a memory", () => {
  test("server filenames are judged by their sniffed extension", () => {
    expect(mem.kindForFilename("3f2b1c9e-1111-2222-3333-444455556666.jpg")).toBe("photo");
    expect(mem.kindForFilename("3f2b1c9e-1111-2222-3333-444455556666.heic")).toBe("photo");
    expect(mem.kindForFilename("3f2b1c9e-1111-2222-3333-444455556666.mov")).toBe("video");
    expect(mem.kindForFilename("3f2b1c9e-1111-2222-3333-444455556666.pdf")).toBeNull();
    expect(mem.kindForFilename("../etc/passwd.jpg")).toBeNull();
  });

  test("thumbnails must be small JPEG/WebP data URLs", () => {
    expect(mem.validThumb(THUMB)).toBe(THUMB);
    expect(mem.validThumb("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(mem.validThumb("javascript:alert(1)")).toBeNull();
    expect(mem.validThumb(`data:image/jpeg;base64,${"A".repeat(mem.MAX_THUMB_CHARS)}`)).toBeNull();
  });
});

describe("library against the real migration", () => {
  test("newest first, paged by taken date, filtered by folder", async () => {
    const db = memoryDb();
    await mem.saveAlbum(db, { id: "beach", name: "Beach", note: "" }, "devin", 1);
    await mem.insertMemory(db, photo("a", 1000));
    await mem.insertMemory(db, photo("b", 3000, "beach"));
    await mem.insertMemory(db, photo("c", 2000, "beach", null));

    expect((await mem.listMemories(db, { albumId: "all", before: null, limit: 60 })).map((m) => m.id)).toEqual(["b", "c", "a"]);
    expect((await mem.listMemories(db, { albumId: "all", before: { takenAt: 3000, id: "b" }, limit: 1 })).map((m) => m.id)).toEqual(["c"]);
    expect((await mem.listMemories(db, { albumId: null, before: null, limit: 60 })).map((m) => m.id)).toEqual(["a"]);
    expect((await mem.listMemories(db, { albumId: "beach", before: null, limit: 60 })).map((m) => [m.id, m.hasThumb])).toEqual([["b", true], ["c", false]]);

    const [album] = await mem.listAlbums(db);
    expect(album).toMatchObject({ name: "Beach", count: 2, coverId: "b", latest: 3000 });
    expect(await mem.stats(db)).toEqual({ count: 3, bytes: 3000, photos: 3, videos: 0 });
  });

  test("a burst taken in the same second pages without skipping", async () => {
    const db = memoryDb();
    for (const id of ["a", "b", "c", "d"]) await mem.insertMemory(db, photo(id, 5000));
    const first = await mem.listMemories(db, { albumId: "all", before: null, limit: 2 });
    const last = first[first.length - 1]!;
    const second = await mem.listMemories(db, { albumId: "all", before: { takenAt: last.takenAt, id: last.id }, limit: 2 });
    expect([...first, ...second].map((m) => m.id)).toEqual(["d", "c", "b", "a"]);
  });

  test("thumbs batch is capped by size", async () => {
    const db = memoryDb();
    await mem.insertMemory(db, photo("a", 1));
    await mem.insertMemory(db, photo("b", 2));
    const all = await mem.thumbs(db, ["a", "b", "missing"]);
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);
    expect(Object.keys(await mem.thumbs(db, ["a", "b"], THUMB.length))).toHaveLength(1);
  });

  test("removing a folder keeps its photos", async () => {
    const db = memoryDb();
    await mem.saveAlbum(db, { id: "x", name: "X", note: "" }, "devin", 1);
    await mem.insertMemory(db, photo("a", 1, "x"));
    await mem.archiveAlbum(db, "x");
    expect(await mem.listAlbums(db)).toEqual([]);
    expect((await mem.getMemory(db, "a"))?.albumId).toBeNull();
  });

  test("uploads that never became a memory are swept as orphans", async () => {
    const db = memoryDb();
    const used = photo("a", 1);
    await mem.notePendingUpload(db, { filename: used.filename, uploadedBy: "devin", mimeType: "image/jpeg", size: 1 }, 10);
    await mem.notePendingUpload(db, { filename: "lost0000-0000.jpg", uploadedBy: "devin", mimeType: "image/jpeg", size: 1 }, 10);
    await mem.notePendingUpload(db, { filename: "fresh000-0000.jpg", uploadedBy: "devin", mimeType: "image/jpeg", size: 1 }, 500);
    await mem.insertMemory(db, used);
    expect(await mem.getPendingUpload(db, "lost0000-0000.jpg")).toEqual({ uploadedBy: "devin", mime: "image/jpeg", size: 1 });
    expect(await mem.stalePendingUploads(db, 100)).toEqual([
      { filename: used.filename, orphan: false },
      { filename: "lost0000-0000.jpg", orphan: true },
    ]);
  });
});
