/** A source document to ingest. */
export interface Doc {
  /** Stable id for the document (e.g. file path, URL, db id). */
  id: string;
  /** Human-readable origin shown in citations. */
  source: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/** A chunk of a document, after splitting. */
export interface Chunk {
  id: string; // `${docId}#${index}`
  docId: string;
  source: string;
  index: number;
  text: string;
  /** sha256 of the chunk text — powers idempotent ingestion (skip unchanged). */
  contentHash: string;
}

export interface StoredChunk extends Chunk {
  embedding: number[];
}

export interface RetrievedChunk extends Chunk {
  /** cosine similarity in [-1, 1] (higher = more relevant). */
  score: number;
}

export interface Citation {
  source: string;
  chunkId: string;
  score: number;
  snippet: string;
}

export interface Answer {
  answer: string;
  citations: Citation[];
  /** false when the guardrail refused (no relevant context). */
  grounded: boolean;
  retrieved: RetrievedChunk[];
}

// ── Pluggable providers ─────────────────────────────────────────────────────

/** Turns text into vectors. Implementations: OpenAI (prod), Hash (offline/tests). */
export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Stores + searches vectors. Implementations: pgvector (prod), Memory (dev/tests). */
export interface VectorStore {
  /** Which chunk content-hashes already exist for a doc (for idempotent ingest). */
  existingHashes(docId: string): Promise<Set<string>>;
  upsert(chunks: StoredChunk[]): Promise<void>;
  /** Remove chunks of a doc whose hash is no longer present (changed/deleted). */
  pruneDoc(docId: string, keepHashes: Set<string>): Promise<number>;
  query(embedding: number[], k: number): Promise<RetrievedChunk[]>;
  count(): Promise<number>;
}

/** Generates an answer from a prompt. Implementations: OpenAI (prod), mock (tests). */
export interface Chat {
  readonly id: string;
  complete(
    system: string,
    user: string,
  ): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>;
}
