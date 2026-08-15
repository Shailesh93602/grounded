import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ingest, ask } from "../src/core/pipeline";
import { loadDocsFromDir } from "../src/core/load";
import { PgVectorStore } from "../src/stores/pgvector";
import { migrate, HNSW_MAX_DIM } from "../src/stores/pgvector-migrate";
import { HashEmbedder } from "../src/embedders/hash";
import { ExtractiveChat } from "../src/llm/offline";
import { docsDir, RecordingChat } from "./helpers";

/**
 * The production store. Skipped unless a pgvector database is provided, so the
 * default `npm test` stays offline/zero-setup as advertised:
 *
 *   docker compose up -d
 *   GROUNDED_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/grounded npm test
 *
 * When it IS provided, these run the same pipeline code as the memory-store
 * tests — which is the actual proof of the "store-agnostic" claim.
 */
const DB_URL = process.env.GROUNDED_TEST_DATABASE_URL;
/**
 * 1536 = text-embedding-3-small, the documented production default, and within
 * pgvector's HNSW limit. Deliberately NOT a small dim: at e.g. 256 the offline
 * HashEmbedder collides enough to score off-topic questions above the guardrail
 * threshold, which would make these tests assert the wrong behaviour.
 */
const DIM = 1536;

describe.skipIf(!DB_URL)("pgvector store (production path)", () => {
  let pool: Pool;
  let store: PgVectorStore;
  const embedder = new HashEmbedder(DIM);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 4 });
    // Start from a known-clean schema so counts are unambiguous.
    await pool.query("DROP TABLE IF EXISTS chunks");
    await migrate(pool, DIM);
    store = new PgVectorStore(pool);
  });

  afterAll(async () => {
    await pool?.query("DROP TABLE IF EXISTS chunks").catch(() => {});
    await pool?.end().catch(() => {});
  });

  it("migrate() creates the table, the cosine index and the vector extension", async () => {
    const ext = await pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'vector'",
    );
    expect(ext.rowCount).toBe(1);

    const col = await pool.query<{ udt_name: string }>(
      "SELECT udt_name FROM information_schema.columns WHERE table_name='chunks' AND column_name='embedding'",
    );
    expect(col.rows[0]!.udt_name).toBe("vector");

    const idx = await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename='chunks' AND indexname='idx_chunks_embedding'",
    );
    expect(idx.rows[0]!.indexdef).toContain("vector_cosine_ops");
  });

  it("is genuinely idempotent: ingesting the same docs twice creates NO duplicate rows", async () => {
    const docs = loadDocsFromDir(docsDir);

    const first = await ingest(docs, { embedder, store });
    expect(first.embedded).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);
    const countAfterFirst = await store.count();
    expect(countAfterFirst).toBe(first.embedded);

    const second = await ingest(docs, { embedder, store });
    expect(second.embedded).toBe(0); // nothing re-embedded → no wasted API spend
    expect(second.skipped).toBe(first.embedded);
    expect(second.pruned).toBe(0);
    expect(await store.count()).toBe(countAfterFirst); // no duplicate rows

    // And a third pass, straight against SQL — no duplicate ids or hashes.
    await ingest(docs, { embedder, store });
    const dupes = await pool.query(
      "SELECT id, count(*) FROM chunks GROUP BY id HAVING count(*) > 1",
    );
    expect(dupes.rowCount).toBe(0);
    expect(await store.count()).toBe(countAfterFirst);
  });

  it("re-embeds only what changed and prunes stale rows", async () => {
    await pool.query("DELETE FROM chunks");

    const long = Array.from(
      { length: 80 },
      (_, i) => `Section ${i} discusses unique topic w${i} in detail here.`,
    ).join(" ");
    const first = await ingest([{ id: "x", source: "x", text: long }], {
      embedder,
      store,
    });
    expect(first.embedded).toBeGreaterThan(1);

    const shrunk = await ingest(
      [{ id: "x", source: "x", text: "A short replacement document." }],
      { embedder, store },
    );
    expect(shrunk.embedded).toBeGreaterThan(0);
    expect(shrunk.pruned).toBeGreaterThan(0);
    expect(await store.count()).toBe(1);
  });

  it("retrieves by real cosine similarity and returns scores in [-1, 1]", async () => {
    await pool.query("DELETE FROM chunks");
    await ingest(loadDocsFromDir(docsDir), { embedder, store });

    const [q] = await embedder.embed([
      "How do refunds work and how do I cancel my subscription?",
    ]);
    const hits = await store.query(q!, 3);

    expect(hits.length).toBe(3);
    expect(hits[0]!.source).toBe("billing.md");
    for (const h of hits) {
      expect(h.score).toBeGreaterThanOrEqual(-1);
      expect(h.score).toBeLessThanOrEqual(1);
    }
    // Ordered best-first.
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThanOrEqual(hits[2]!.score);
  });

  it("the guardrail behaves identically on pgvector as on the memory store", async () => {
    await pool.query("DELETE FROM chunks");
    await ingest(loadDocsFromDir(docsDir), { embedder, store });
    const chat = new RecordingChat();

    const refused = await ask("What is the airspeed velocity of an unladen swallow?", {
      embedder,
      store,
      chat,
      k: 5,
      minScore: 0.15,
    });
    expect(refused.grounded).toBe(false);
    expect(chat.calls).toHaveLength(0);

    const answered = await ask(
      "How do refunds work and how do I cancel my subscription?",
      { embedder, store, chat: new ExtractiveChat(), k: 5, minScore: 0.15 },
    );
    expect(answered.grounded).toBe(true);
    expect(answered.citations[0]!.source).toBe("billing.md");
  });

  it("citations resolve to rows that really exist in Postgres", async () => {
    await pool.query("DELETE FROM chunks");
    await ingest(loadDocsFromDir(docsDir), { embedder, store });

    const a = await ask("How do refunds work and how do I cancel my subscription?", {
      embedder,
      store,
      chat: new ExtractiveChat(),
      k: 5,
      minScore: 0.15,
    });
    expect(a.grounded).toBe(true);

    for (const c of a.citations) {
      const row = await pool.query<{ text: string; source: string }>(
        "SELECT text, source FROM chunks WHERE id = $1",
        [c.chunkId],
      );
      expect(row.rowCount, `no row for cited chunk ${c.chunkId}`).toBe(1);
      expect(row.rows[0]!.source).toBe(c.source);
      expect(row.rows[0]!.text.startsWith(c.snippet)).toBe(true);
    }
  });

  it("migrate() survives dims above pgvector's HNSW limit instead of half-failing", async () => {
    // pgvector caps HNSW at 2000 dims, which excludes text-embedding-3-large
    // (3072) and the offline HashEmbedder's 4096 default. Previously the table
    // was created and then CREATE INDEX threw, leaving an unusable half-migrated
    // schema. Now it degrades to exact search and reports that it did.
    const wide = new Pool({ connectionString: DB_URL, max: 1 });
    try {
      await wide.query("DROP TABLE IF EXISTS chunks");
      const indexed = await migrate(wide, 3072);
      expect(indexed).toBe(false);

      // Table exists and is usable...
      const col = await wide.query<{ udt_name: string }>(
        "SELECT udt_name FROM information_schema.columns WHERE table_name='chunks' AND column_name='embedding'",
      );
      expect(col.rows[0]!.udt_name).toBe("vector");
      // ...just without the ANN index.
      const idx = await wide.query(
        "SELECT 1 FROM pg_indexes WHERE tablename='chunks' AND indexname='idx_chunks_embedding'",
      );
      expect(idx.rowCount).toBe(0);

      // And a within-limit dim still gets the index.
      await wide.query("DROP TABLE IF EXISTS chunks");
      expect(await migrate(wide, HNSW_MAX_DIM)).toBe(true);
    } finally {
      // Restore the schema the other tests share.
      await wide.query("DROP TABLE IF EXISTS chunks").catch(() => {});
      await migrate(wide, DIM).catch(() => {});
      await wide.end().catch(() => {});
    }
  });

  it("migrate() rejects a nonsense EMBED_DIM instead of building a broken table", async () => {
    const p = new Pool({ connectionString: DB_URL, max: 1 });
    try {
      await expect(migrate(p, Number("not-a-number"))).rejects.toThrow(
        /EMBED_DIM must be a positive integer/,
      );
      await expect(migrate(p, 0)).rejects.toThrow();
    } finally {
      await p.end().catch(() => {});
    }
  });

  it("upsert is transactional — a bad batch leaves no partial rows behind", async () => {
    await pool.query("DELETE FROM chunks");
    const before = await store.count();

    const good = {
      id: "t#0",
      docId: "t",
      source: "t",
      index: 0,
      text: "fine",
      contentHash: "h0",
      embedding: new Array(DIM).fill(0.1),
    };
    const bad = { ...good, id: "t#1", embedding: new Array(DIM + 5).fill(0.1) }; // wrong dim

    await expect(store.upsert([good, bad])).rejects.toThrow();
    expect(await store.count()).toBe(before); // rolled back, not half-written
  });
});

describe.skipIf(!!DB_URL)("pgvector store", () => {
  it("is skipped without GROUNDED_TEST_DATABASE_URL (offline default)", () => {
    expect(DB_URL).toBeUndefined();
  });
});
