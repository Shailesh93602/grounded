import OpenAI from "openai";
import type { Embedder } from "../core/types";
import { withRetry } from "../core/retry";

/** Production embedder. Honors a custom baseURL (Azure / proxies / compatible APIs). */
export class OpenAIEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;
  private client: OpenAI;
  private model: string;

  constructor(opts: {
    apiKey: string;
    baseURL?: string;
    model?: string;
    dimensions?: number;
  }) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model ?? "text-embedding-3-small";
    this.dimensions = opts.dimensions ?? 1536;
    this.id = `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await withRetry(() =>
      this.client.embeddings.create({ model: this.model, input: texts }),
    );
    // Preserve input order.
    return res.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding as number[]);
  }
}
