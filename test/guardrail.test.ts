import { describe, it, expect } from "vitest";
import { ingest, ask, REFUSAL } from "../src/core/pipeline";
import { loadDocsFromDir } from "../src/core/load";
import { HashEmbedder } from "../src/embedders/hash";
import { MemoryStore } from "../src/stores/memory";
import { offlineEngine, docsDir, RecordingChat } from "./helpers";

describe("'I don't know' guardrail", () => {
  it("refuses an off-topic question and does NOT call the LLM", async () => {
    const embedder = new HashEmbedder(4096);
    const store = new MemoryStore();
    const chat = new RecordingChat();
    await ingest(loadDocsFromDir(docsDir), { embedder, store });

    const a = await ask("What is the airspeed velocity of an unladen swallow?", {
      embedder,
      store,
      chat,
      k: 5,
      minScore: 0.15,
    });

    expect(a.grounded).toBe(false);
    expect(a.answer).toBe(REFUSAL);
    expect(a.citations).toHaveLength(0);
    expect(chat.calls).toHaveLength(0); // never hit the model → no cost, no hallucination
  });

  it("answers when the question IS covered (sanity vs the refusal above)", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);
    const a = await ask(
      "Is Acme SOC 2 compliant and how are passwords and data encrypted?",
      e,
    );
    expect(a.grounded).toBe(true);
    expect(a.retrieved[0]!.source).toBe("security.md");
  });
});
