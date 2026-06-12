import type { Embedder } from "../core/types";

/**
 * Deterministic, offline embedder: a normalized bag of hashed tokens. No API
 * key, no cost — texts that share words get similar vectors, so it's good
 * enough to exercise the *whole* retrieval/ranking pipeline in tests & local
 * dev. Swap to OpenAIEmbedder for production (env-driven). Not for real
 * semantic quality — it's a test/dev stand-in.
 */
const STOPWORDS = new Set(
  "a an and are as at be by for from has have how in is it its of on or that the to was were will with what which do does you your we our this these those i me my".split(
    " ",
  ),
);

export class HashEmbedder implements Embedder {
  readonly id = "hash-embedder";
  constructor(readonly dimensions = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const tok of tokens) {
      // skip stopwords so similarity reflects content words, not "the/of/is"
      if (STOPWORDS.has(tok)) continue;
      v[this.hash(tok) % this.dimensions]! += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }

  private hash(tok: string): number {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }
}
