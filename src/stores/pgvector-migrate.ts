import { Pool } from "pg";

/**
 * pgvector refuses to build an HNSW index on columns wider than this. Notably
 * this excludes OpenAI's text-embedding-3-large (3072) and the offline
 * HashEmbedder's 4096 default — so we degrade to exact search rather than
 * failing the migration half-way and leaving a table with no index.
 */
export const HNSW_MAX_DIM = 2000;

/**
 * Create the pgvector extension, the chunks table, and a cosine index.
 * Dimensions must match your embedder (env EMBED_DIM, default 1536 for
 * text-embedding-3-small). Run: `npm run migrate`.
 *
 * Returns whether the ANN index was created (false = exact search: correct
 * results, slower on large corpora).
 */
export async function migrate(pool: Pool, dim: number): Promise<boolean> {
  if (!Number.isInteger(dim) || dim < 1) {
    throw new Error(`EMBED_DIM must be a positive integer, got: ${dim}`);
  }

  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id           TEXT PRIMARY KEY,
      doc_id       TEXT NOT NULL,
      source       TEXT NOT NULL,
      idx          INTEGER NOT NULL,
      text         TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding    vector(${dim}) NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks (doc_id)`);

  if (dim > HNSW_MAX_DIM) {
    console.warn(
      `! vector dim ${dim} exceeds pgvector's HNSW limit of ${HNSW_MAX_DIM} — ` +
        `skipping the ANN index. Queries still return correct results via exact ` +
        `search, but will slow down as the corpus grows. To get the index, use ` +
        `an embedding model of <=${HNSW_MAX_DIM} dims (e.g. text-embedding-3-small ` +
        `at 1536, or text-embedding-3-large truncated via EMBED_DIM=1536).`,
    );
    return false;
  }

  // Cosine index for fast ANN search.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_chunks_embedding
       ON chunks USING hnsw (embedding vector_cosine_ops)`,
  );
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url =
    process.env.DATABASE_URL ?? "postgresql://localhost:5432/grounded";
  const dim = Number(process.env.EMBED_DIM ?? 1536);
  const pool = new Pool({ connectionString: url, max: 1 });
  migrate(pool, dim)
    .then((indexed) =>
      console.log(
        `✓ migrated (vector dim=${dim}, ann index=${indexed ? "hnsw" : "none — exact search"})`,
      ),
    )
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => pool.end());
}
