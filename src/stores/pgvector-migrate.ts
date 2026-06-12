import { Pool } from "pg";

/**
 * Create the pgvector extension, the chunks table, and a cosine index.
 * Dimensions must match your embedder (env EMBED_DIM, default 1536 for
 * text-embedding-3-small). Run: `npm run migrate`.
 */
export async function migrate(pool: Pool, dim: number): Promise<void> {
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
  // Cosine index for fast ANN search.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_chunks_embedding
       ON chunks USING hnsw (embedding vector_cosine_ops)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url =
    process.env.DATABASE_URL ?? "postgresql://localhost:5432/grounded";
  const dim = Number(process.env.EMBED_DIM ?? 1536);
  const pool = new Pool({ connectionString: url, max: 1 });
  migrate(pool, dim)
    .then(() => console.log(`✓ migrated (vector dim=${dim})`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => pool.end());
}
