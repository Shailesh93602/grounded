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

  // ── Trying to break the guardrail ─────────────────────────────────────────
  // The refusal is the product's whole selling point, so these push on the
  // three ways it could silently stop working.

  it("refuses on a completely EMPTY store (nothing ingested at all)", async () => {
    const embedder = new HashEmbedder(4096);
    const store = new MemoryStore();
    const chat = new RecordingChat();

    const a = await ask("How do refunds work?", {
      embedder,
      store,
      chat,
      k: 5,
      minScore: 0.15,
    });

    expect(await store.count()).toBe(0);
    expect(a.retrieved).toHaveLength(0);
    expect(a.grounded).toBe(false);
    expect(a.answer).toBe(REFUSAL);
    expect(chat.calls).toHaveLength(0);
  });

  it("refuses on a BELOW-THRESHOLD score even though chunks were retrieved", async () => {
    // Distinct from the empty-store case: retrieval genuinely returns rows here,
    // so this proves the numeric threshold is doing the work — not a
    // "no results" shortcut.
    const embedder = new HashEmbedder(4096);
    const store = new MemoryStore();
    const chat = new RecordingChat();
    await ingest(loadDocsFromDir(docsDir), { embedder, store });

    const question = "How do refunds work and how do I cancel my subscription?";
    const base = { embedder, store, chat, k: 5 };

    // Baseline: this question IS answerable at the normal threshold.
    const allowed = await ask(question, { ...base, minScore: 0.15 });
    expect(allowed.grounded).toBe(true);
    expect(allowed.retrieved.length).toBeGreaterThan(0);
    const topScore = allowed.retrieved[0]!.score;
    expect(topScore).toBeGreaterThan(0);

    // Same question, threshold raised just above the real top score → refuse.
    chat.calls.length = 0;
    const refused = await ask(question, { ...base, minScore: topScore + 0.01 });
    expect(refused.retrieved.length).toBeGreaterThan(0); // context WAS retrieved
    expect(refused.retrieved[0]!.score).toBeCloseTo(topScore, 10);
    expect(refused.grounded).toBe(false);
    expect(refused.answer).toBe(REFUSAL);
    expect(refused.citations).toHaveLength(0);
    expect(chat.calls).toHaveLength(0); // still never paid for a model call
  });

  it("is not a stuck 'always refuse': dropping the threshold lets the same question through", async () => {
    // Guards against the opposite failure — a guardrail that refuses everything
    // would technically never hallucinate but would also be useless.
    const embedder = new HashEmbedder(4096);
    const store = new MemoryStore();
    const chat = new RecordingChat();
    await ingest(loadDocsFromDir(docsDir), { embedder, store });

    const offTopic = "What is the airspeed velocity of an unladen swallow?";
    const strict = await ask(offTopic, {
      embedder,
      store,
      chat,
      k: 5,
      minScore: 0.15,
    });
    expect(strict.grounded).toBe(false);

    // minScore below the (zero) similarity → the model IS consulted.
    const loose = await ask(offTopic, {
      embedder,
      store,
      chat,
      k: 5,
      minScore: -1,
    });
    expect(loose.grounded).toBe(true);
    expect(chat.calls).toHaveLength(1);
  });

  it("refuses paraphrased-but-unsupported questions rather than answering from a near-miss", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);

    // Plausible-sounding, but the corpus (billing/shipping/security) says
    // nothing about any of these.
    for (const q of [
      "How do I fine-tune a large language model on my own data?",
      "What is the capital city of Mongolia?",
      "Which kubernetes ingress controller should I pick?",
    ]) {
      const a = await ask(q, e);
      expect(a.grounded, `expected refusal for: ${q}`).toBe(false);
      expect(a.answer).toBe(REFUSAL);
    }
  });
});
