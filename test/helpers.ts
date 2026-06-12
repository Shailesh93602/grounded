import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HashEmbedder } from "../src/embedders/hash";
import { MemoryStore } from "../src/stores/memory";
import { ExtractiveChat } from "../src/llm/offline";
import type { Chat } from "../src/core/types";

export const docsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
  "docs",
);

/** A fresh offline engine for a test (deterministic, no API key). */
export function offlineEngine() {
  return {
    embedder: new HashEmbedder(4096),
    store: new MemoryStore(),
    chat: new ExtractiveChat(),
    k: 5,
    minScore: 0.15,
  };
}

/** Chat double that records calls — to assert the guardrail skips the LLM. */
export class RecordingChat implements Chat {
  readonly id = "recording";
  calls: Array<{ system: string; user: string }> = [];
  constructor(private reply = "stub answer [1]") {}
  async complete(system: string, user: string) {
    this.calls.push({ system, user });
    return { text: this.reply };
  }
}
