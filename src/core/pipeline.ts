import { chunkDoc, type ChunkOptions } from "./chunk";
import type {
  Answer,
  Chat,
  Citation,
  Doc,
  Embedder,
  StoredChunk,
  VectorStore,
} from "./types";

export interface IngestResult {
  docs: number;
  /** chunks newly embedded this run */
  embedded: number;
  /** unchanged chunks skipped (idempotency at work) */
  skipped: number;
  /** stale chunks removed (doc shrank/changed) */
  pruned: number;
}

/**
 * Idempotent ingestion: only NEW/changed chunks (by content hash) get embedded;
 * unchanged ones are skipped (no API cost), and chunks that no longer exist are
 * pruned. Re-ingesting the same docs is a near-no-op.
 */
export async function ingest(
  docs: Doc[],
  deps: { embedder: Embedder; store: VectorStore; chunk?: ChunkOptions },
): Promise<IngestResult> {
  let embedded = 0;
  let skipped = 0;
  let pruned = 0;

  for (const doc of docs) {
    const chunks = chunkDoc(doc, deps.chunk);
    const keep = new Set(chunks.map((c) => c.contentHash));
    const existing = await deps.store.existingHashes(doc.id);

    const fresh = chunks.filter((c) => !existing.has(c.contentHash));
    skipped += chunks.length - fresh.length;

    if (fresh.length > 0) {
      const vectors = await deps.embedder.embed(fresh.map((c) => c.text));
      const stored: StoredChunk[] = fresh.map((c, i) => ({
        ...c,
        embedding: vectors[i]!,
      }));
      await deps.store.upsert(stored);
      embedded += fresh.length;
    }

    pruned += await deps.store.pruneDoc(doc.id, keep);
  }

  return { docs: docs.length, embedded, skipped, pruned };
}

export interface AskOptions {
  embedder: Embedder;
  store: VectorStore;
  chat: Chat;
  /** how many chunks to retrieve */
  k?: number;
  /** minimum top-similarity to attempt an answer (else refuse) */
  minScore?: number;
}

export const REFUSAL =
  "I don't have enough information in the provided sources to answer that.";

const SYSTEM_PROMPT =
  "You are a precise assistant. Answer ONLY using the provided context. " +
  "If the answer is not in the context, say you don't know — never guess. " +
  "Cite sources inline using [n] that match the numbered context blocks.";

/**
 * Retrieve → guardrail → cited answer.
 * The guardrail is the key reliability bit: if nothing retrieved clears
 * `minScore`, we refuse instead of letting the model hallucinate.
 */
export async function ask(
  question: string,
  opts: AskOptions,
): Promise<Answer> {
  const k = opts.k ?? 5;
  const minScore = opts.minScore ?? 0.2;

  const [qVec] = await opts.embedder.embed([question]);
  const retrieved = await opts.store.query(qVec!, k);
  const top = retrieved[0];

  // Guardrail: no relevant context → refuse (don't hallucinate).
  if (!top || top.score < minScore) {
    return { answer: REFUSAL, citations: [], grounded: false, retrieved };
  }

  // Only chunks that clear the bar become context/citations. A top-k pull
  // always returns k rows, including irrelevant ones (score ~0) — feeding those
  // to the model wastes tokens and invites distraction, and "citing" them makes
  // the citation list untrustworthy. `retrieved` still carries the full pull for
  // debugging and eval.
  const relevant = retrieved.filter((r) => r.score >= minScore);

  const context = relevant
    .map((r, i) => `[${i + 1}] (source: ${r.source})\n${r.text}`)
    .join("\n\n");
  const user = `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer using only the context above, citing sources as [n].`;

  const { text } = await opts.chat.complete(SYSTEM_PROMPT, user);

  const citations: Citation[] = relevant.map((r) => ({
    source: r.source,
    chunkId: r.id,
    score: r.score,
    snippet: r.text.slice(0, 200),
  }));

  return { answer: text.trim(), citations, grounded: true, retrieved };
}
