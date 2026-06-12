import type { Pool } from "pg";
import type { RetrievedChunk, StoredChunk, VectorStore } from "../core/types";

const toVector = (e: number[]) => `[${e.join(",")}]`;

/**
 * Production vector store on Postgres + pgvector. Same interface as MemoryStore.
 * Run `npm run migrate` once (creates the extension, table, and a cosine index).
 */
export class PgVectorStore implements VectorStore {
  constructor(private pool: Pool) {}

  async existingHashes(docId: string): Promise<Set<string>> {
    const r = await this.pool.query<{ content_hash: string }>(
      `SELECT content_hash FROM chunks WHERE doc_id = $1`,
      [docId],
    );
    return new Set(r.rows.map((row) => row.content_hash));
  }

  async upsert(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const c of chunks) {
        await client.query(
          `INSERT INTO chunks (id, doc_id, source, idx, text, content_hash, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7::vector)
           ON CONFLICT (id) DO UPDATE SET
             source = EXCLUDED.source, idx = EXCLUDED.idx, text = EXCLUDED.text,
             content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding`,
          [c.id, c.docId, c.source, c.index, c.text, c.contentHash, toVector(c.embedding)],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async pruneDoc(docId: string, keepHashes: Set<string>): Promise<number> {
    const r = await this.pool.query(
      `DELETE FROM chunks WHERE doc_id = $1 AND NOT (content_hash = ANY($2::text[]))`,
      [docId, [...keepHashes]],
    );
    return r.rowCount ?? 0;
  }

  async query(embedding: number[], k: number): Promise<RetrievedChunk[]> {
    // `<=>` is cosine distance with vector_cosine_ops; score = 1 - distance.
    const r = await this.pool.query<{
      id: string;
      doc_id: string;
      source: string;
      idx: number;
      text: string;
      content_hash: string;
      score: number;
    }>(
      `SELECT id, doc_id, source, idx, text, content_hash,
              1 - (embedding <=> $1::vector) AS score
         FROM chunks
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [toVector(embedding), k],
    );
    return r.rows.map((row) => ({
      id: row.id,
      docId: row.doc_id,
      source: row.source,
      index: row.idx,
      text: row.text,
      contentHash: row.content_hash,
      score: Number(row.score),
    }));
  }

  async count(): Promise<number> {
    const r = await this.pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM chunks`,
    );
    return r.rows[0]?.c ?? 0;
  }
}
