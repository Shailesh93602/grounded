import { Pool } from "pg";
import { HashEmbedder } from "./embedders/hash";
import { OpenAIEmbedder } from "./embedders/openai";
import { MemoryStore } from "./stores/memory";
import { PgVectorStore } from "./stores/pgvector";
import { OpenAIChat } from "./llm/openai";
import { ExtractiveChat } from "./llm/offline";
import type { Chat, Embedder, VectorStore } from "./core/types";

export interface Engine {
  embedder: Embedder;
  store: VectorStore;
  chat: Chat;
  k: number;
  minScore: number;
}

/**
 * Build the engine from env. Defaults are **zero-setup** (offline embedder +
 * in-memory store + extractive chat) so `npm start` works with no API key.
 *
 *   PROVIDER = offline | openai          (default offline)
 *   STORE    = memory  | pgvector        (default memory)
 *   OPENAI_API_KEY, OPENAI_BASE_URL, EMBED_MODEL, CHAT_MODEL, EMBED_DIM
 *   DATABASE_URL (for pgvector)
 *   RAG_K, RAG_MIN_SCORE
 */
export function buildEngine(): Engine {
  const provider = (process.env.PROVIDER ?? "offline").toLowerCase();
  const storeKind = (process.env.STORE ?? "memory").toLowerCase();
  // Offline uses a high dimension so hash collisions don't create false matches.
  const dim = Number(process.env.EMBED_DIM ?? (provider === "openai" ? 1536 : 4096));

  let embedder: Embedder;
  let chat: Chat;
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required when PROVIDER=openai");
    const baseURL = process.env.OPENAI_BASE_URL;
    embedder = new OpenAIEmbedder({
      apiKey,
      baseURL,
      model: process.env.EMBED_MODEL,
      dimensions: dim,
    });
    chat = new OpenAIChat({ apiKey, baseURL, model: process.env.CHAT_MODEL });
  } else {
    embedder = new HashEmbedder(dim);
    chat = new ExtractiveChat();
  }

  let store: VectorStore;
  if (storeKind === "pgvector") {
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://localhost:5432/grounded",
    });
    pool.on("error", () => {});
    store = new PgVectorStore(pool);
  } else {
    store = new MemoryStore();
  }

  return {
    embedder,
    store,
    chat,
    k: Number(process.env.RAG_K ?? 5),
    minScore: Number(process.env.RAG_MIN_SCORE ?? (provider === "openai" ? 0.25 : 0.15)),
  };
}
