import { describe, it, expect } from "vitest";
import { ingest } from "../src/core/pipeline";
import { loadDocsFromDir } from "../src/core/load";
import { runEval, type EvalCase } from "../src/eval/run";
import { HashEmbedder } from "../src/embedders/hash";
import { MemoryStore } from "../src/stores/memory";
import { ExtractiveChat } from "../src/llm/offline";
import { offlineEngine, docsDir, RecordingChat } from "./helpers";

/**
 * An eval harness that always passes is worse than no eval harness — it gives
 * false confidence in CI. These tests check the scoring DISCRIMINATES: a
 * deliberately wrong answer must score lower than a correct one, and each of
 * the three signals (retrieval / guardrail / answer content) must be able to
 * fail independently.
 */
describe("eval scoring is discriminating (not trivially always-passing)", () => {
  const goodCases: EvalCase[] = [
    {
      question: "How do refunds work and how do I cancel my subscription?",
      expectSource: "billing.md",
      expectGrounded: true,
      expectAnswerIncludes: ["14"],
    },
    {
      question: "What is the airspeed velocity of an unladen swallow?",
      expectGrounded: false,
    },
  ];

  it("a correct pipeline scores 100%", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);
    const s = await runEval(goodCases, e);
    expect(s.passed).toBe(s.total);
    expect(s.retrievalHitRate).toBe(1);
  });

  it("a deliberately WRONG answerer scores strictly lower than the correct one", async () => {
    const docs = loadDocsFromDir(docsDir);

    const good = offlineEngine();
    await ingest(docs, good);
    const goodScore = (await runEval(goodCases, good)).passed;

    // Same retrieval, same guardrail — only the generated answer is garbage.
    const embedder = new HashEmbedder(4096);
    const store = new MemoryStore();
    await ingest(docs, { embedder, store });
    const bad = {
      embedder,
      store,
      chat: new RecordingChat("Refunds take 9999 years. Probably. [1]"),
      k: 5,
      minScore: 0.15,
    };
    const badSummary = await runEval(goodCases, bad);

    expect(badSummary.passed).toBeLessThan(goodScore);
    // Retrieval still worked; it's the ANSWER assertion that failed.
    expect(badSummary.retrievalHitRate).toBe(1);
    const refundCase = badSummary.results[0]!;
    expect(refundCase.retrievalHit).toBe(true);
    expect(refundCase.groundedOk).toBe(true);
    expect(refundCase.answerHit).toBe(false);
    expect(refundCase.pass).toBe(false);
  });

  it("catches a retrieval regression (empty store → grounded cases fail, hit-rate drops)", async () => {
    const s = await runEval(goodCases, {
      embedder: new HashEmbedder(4096),
      store: new MemoryStore(), // nothing ingested = total retrieval failure
      chat: new ExtractiveChat(),
      k: 5,
      minScore: 0.15,
    });

    expect(s.retrievalHitRate).toBe(0);
    expect(s.results[0]!.pass).toBe(false); // expected grounded, got refusal
    expect(s.results[1]!.pass).toBe(true); // expected refusal, still refuses
    expect(s.passed).toBe(1);
    expect(s.passed).toBeLessThan(s.total);
  });

  it("catches a guardrail regression (a guardrail that never refuses fails the refusal case)", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);
    // minScore = -1 disables the refusal → the off-topic case must now FAIL.
    const s = await runEval(goodCases, { ...e, minScore: -1 });

    const offTopic = s.results[1]!;
    expect(offTopic.grounded).toBe(true);
    expect(offTopic.groundedOk).toBe(false);
    expect(offTopic.pass).toBe(false);
    expect(s.passed).toBeLessThan(s.total);
  });

  it("catches a wrong-source retrieval (right answer text, wrong document)", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);
    const s = await runEval(
      [
        {
          question: "How do refunds work and how do I cancel my subscription?",
          expectSource: "shipping.md", // it actually comes from billing.md
          expectGrounded: true,
        },
      ],
      e,
    );
    expect(s.results[0]!.retrievalHit).toBe(false);
    expect(s.results[0]!.pass).toBe(false);
    expect(s.retrievalHitRate).toBe(0);
  });

  it("reports per-case scores that reflect real similarity, not constants", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);
    const s = await runEval(goodCases, e);

    const grounded = s.results[0]!;
    const refused = s.results[1]!;
    expect(grounded.topScore).toBeGreaterThan(refused.topScore);
    expect(refused.topScore).toBe(0);
    expect(new Set(s.results.map((r) => r.topScore)).size).toBeGreaterThan(1);
  });
});
