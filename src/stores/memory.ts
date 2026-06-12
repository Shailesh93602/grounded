import { cosineSimilarity } from "../core/rank";
import type { RetrievedChunk, StoredChunk, VectorStore } from "../core/types";

/**
 * In-memory vector store — the default for dev/tests/CI (no DB needed). Same
 * interface as the pgvector store, so the pipeline code is identical; only the
 * adapter changes in production.
 */
export class MemoryStore implements VectorStore {
  private chunks = new Map<string, StoredChunk>(); // keyed by chunk.id

  async existingHashes(docId: string): Promise<Set<string>> {
    const hashes = new Set<string>();
    for (const c of this.chunks.values()) {
      if (c.docId === docId) hashes.add(c.contentHash);
    }
    return hashes;
  }

  async upsert(chunks: StoredChunk[]): Promise<void> {
    for (const c of chunks) this.chunks.set(c.id, c);
  }

  async pruneDoc(docId: string, keepHashes: Set<string>): Promise<number> {
    let removed = 0;
    for (const [id, c] of this.chunks) {
      if (c.docId === docId && !keepHashes.has(c.contentHash)) {
        this.chunks.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async query(embedding: number[], k: number): Promise<RetrievedChunk[]> {
    return [...this.chunks.values()]
      .map((c) => ({ ...c, score: cosineSimilarity(embedding, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ embedding: _embedding, ...rest }) => rest);
  }

  async count(): Promise<number> {
    return this.chunks.size;
  }
}
