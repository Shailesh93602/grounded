import { sha256 } from "./hash";
import type { Chunk, Doc } from "./types";

export interface ChunkOptions {
  /** target chunk size in characters */
  size?: number;
  /** overlap between consecutive chunks in characters */
  overlap?: number;
}

/**
 * Split text into overlapping chunks, preferring to break on a sentence/space
 * boundary near the target size (so chunks don't cut mid-word).
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? 1000;
  const overlap = opts.overlap ?? 150;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const boundary = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(" "),
      );
      if (boundary > size * 0.5) end = start + boundary + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Split a document into Chunk records (with stable ids + content hashes). */
export function chunkDoc(doc: Doc, opts: ChunkOptions = {}): Chunk[] {
  return chunkText(doc.text, opts).map((text, index) => ({
    id: `${doc.id}#${index}`,
    docId: doc.id,
    source: doc.source,
    index,
    text,
    contentHash: sha256(text),
  }));
}
