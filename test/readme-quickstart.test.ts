import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ingest, ask, REFUSAL } from "../src/core/pipeline";
import { HashEmbedder } from "../src/embedders/hash";
import { MemoryStore } from "../src/stores/memory";
import { ExtractiveChat } from "../src/llm/offline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The README quickstart is the first thing a stranger runs. It previously
 * returned a refusal for its own "grounded answer with citations" example
 * (the doc said "Refunds", the question said "refund", and the offline
 * embedder matched tokens exactly) — so the demo made the project look broken.
 * This pins the exact example so it can't silently regress again.
 */
const QUICKSTART_DOC = {
  id: "faq",
  source: "faq.md",
  text: "Refunds are allowed within 30 days.",
};
const GROUNDED_Q = "What is the refund window?";
const OFFTOPIC_Q = "How do I train a neural net?";

// Same defaults `npm start` uses (see src/config.ts: offline provider).
const OFFLINE_DEFAULT_MIN_SCORE = 0.15;

function quickstartEngine() {
  return {
    embedder: new HashEmbedder(4096),
    store: new MemoryStore(),
    chat: new ExtractiveChat(),
    k: 5,
    minScore: OFFLINE_DEFAULT_MIN_SCORE,
  };
}

describe("README quickstart works exactly as written", () => {
  it("the documented ingest call reports one embedded chunk", async () => {
    const e = quickstartEngine();
    const r = await ingest([QUICKSTART_DOC], e);
    expect(r).toEqual({ docs: 1, embedded: 1, skipped: 0, pruned: 0 });
  });

  it("the documented question returns a GROUNDED, cited answer (not a refusal)", async () => {
    const e = quickstartEngine();
    await ingest([QUICKSTART_DOC], e);
    const a = await ask(GROUNDED_Q, e);

    expect(a.grounded).toBe(true);
    expect(a.answer).not.toBe(REFUSAL);
    expect(a.citations).toHaveLength(1);
    expect(a.citations[0]!.source).toBe("faq.md");
    expect(a.citations[0]!.chunkId).toBe("faq#0");
    expect(a.answer).toContain("30 days");
    expect(a.retrieved[0]!.score).toBeGreaterThan(OFFLINE_DEFAULT_MIN_SCORE);
  });

  it("the documented off-topic question returns grounded:false, as the README promises", async () => {
    const e = quickstartEngine();
    await ingest([QUICKSTART_DOC], e);
    const a = await ask(OFFTOPIC_Q, e);

    expect(a.grounded).toBe(false);
    expect(a.answer).toBe(REFUSAL);
    expect(a.citations).toEqual([]);
  });

  it("the README still contains the exact commands these tests cover", () => {
    // If someone edits the README examples, this fails and points them here.
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain(QUICKSTART_DOC.text);
    expect(readme).toContain(GROUNDED_Q);
    expect(readme).toContain(OFFTOPIC_Q);
  });

  it("the README's stated test count matches the real suite size", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const claimed = readme.match(/npm test\s+#\s*(\d+)\s+tests/);
    expect(claimed, "README should state a test count next to `npm test`").not.toBeNull();
    // Counted by the runner itself, so the doc can't drift from reality.
    expect(Number(claimed![1])).toBe(EXPECTED_TEST_COUNT);
  });
});

/**
 * Tests that run in the default offline mode (the 7 pgvector tests are skipped
 * unless GROUNDED_TEST_DATABASE_URL is set). Deliberately hand-maintained: the
 * README quotes this number, so a mismatch breaks the build and forces the doc
 * to be updated rather than quietly becoming a lie.
 */
export const EXPECTED_TEST_COUNT = 41;
