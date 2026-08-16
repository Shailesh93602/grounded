import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest, ask } from "../src/core/pipeline";
import { chunkDoc } from "../src/core/chunk";
import { sha256 } from "../src/core/hash";
import { loadDocsFromDir } from "../src/core/load";
import { HashEmbedder } from "../src/embedders/hash";
import { MemoryStore } from "../src/stores/memory";
import { offlineEngine, docsDir, RecordingChat } from "./helpers";

/**
 * "Cited answers" is a claim about provenance, not formatting. These tests
 * resolve every citation back to a chunk that was really ingested, and back to
 * bytes that really exist in the source file on disk — so a citation can't be
 * invented, mislabelled, or point at a chunk id that no longer exists.
 */
describe("citations resolve to real source chunks", () => {
  it("every citation's chunkId, source, score and snippet match an ingested chunk", async () => {
    const e = offlineEngine();
    const docs = loadDocsFromDir(docsDir);
    await ingest(docs, e);

    // Rebuild the exact chunk set the pipeline stored, keyed by chunk id.
    const byId = new Map(
      docs.flatMap((d) => chunkDoc(d).map((c) => [c.id, c] as const)),
    );
    expect(byId.size).toBe(await e.store.count());

    const a = await ask(
      "How do refunds work and how do I cancel my subscription?",
      e,
    );
    expect(a.grounded).toBe(true);
    expect(a.citations.length).toBeGreaterThan(0);

    for (const c of a.citations) {
      const chunk = byId.get(c.chunkId);
      // 1. The cited id is a chunk that actually exists.
      expect(chunk, `citation chunkId not in store: ${c.chunkId}`).toBeDefined();
      // 2. The cited source is that chunk's real source, not a guess.
      expect(c.source).toBe(chunk!.source);
      // 3. The snippet is verbatim from that chunk (not paraphrased/invented).
      expect(chunk!.text.startsWith(c.snippet)).toBe(true);
      expect(c.snippet.length).toBeLessThanOrEqual(200);
      // 4. The score is a real similarity, not a placeholder.
      expect(c.score).toBeGreaterThan(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  it("cited text really appears in the source file on disk", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);

    const a = await ask(
      "Which countries does Acme deliver to, and how is shipping tracking handled?",
      e,
    );
    expect(a.grounded).toBe(true);

    for (const c of a.citations) {
      const raw = readFileSync(join(docsDir, c.source), "utf8");
      // Chunking collapses whitespace, so compare on the same normalisation.
      const normalized = raw.replace(/\s+/g, " ").trim();
      expect(
        normalized.includes(c.snippet),
        `snippet not found in ${c.source}: ${c.snippet.slice(0, 60)}…`,
      ).toBe(true);
    }
  });

  it("cites ONLY chunks that cleared the guardrail — never zero-relevance filler", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);

    // A top-k pull returns k rows regardless of relevance; on this 3-chunk
    // corpus a refunds question also pulls back security.md and shipping.md at
    // ~0.00. Those must not appear as "sources this answer used".
    const a = await ask("How do refunds work and how do I cancel my subscription?", e);
    expect(a.grounded).toBe(true);
    expect(a.retrieved.length).toBeGreaterThan(a.citations.length);
    expect(a.retrieved.some((r) => r.score < e.minScore)).toBe(true);

    for (const c of a.citations) {
      expect(c.score).toBeGreaterThanOrEqual(e.minScore);
    }
    expect(a.citations.map((c) => c.source)).toEqual(["billing.md"]);

    // Citations are the leading (highest-scoring) slice of the retrieval, in order.
    const scores = a.citations.map((c) => c.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores); // descending
    expect(a.citations.map((c) => c.chunkId)).toEqual(
      a.retrieved.slice(0, a.citations.length).map((r) => r.id),
    );
  });

  it("only the cited chunks are put in front of the model (no irrelevant context)", async () => {
    const embedder = new HashEmbedder(4096);
    const store = new MemoryStore();
    const chat = new RecordingChat();
    await ingest(loadDocsFromDir(docsDir), { embedder, store });

    const a = await ask("How do refunds work and how do I cancel my subscription?", {
      embedder,
      store,
      chat,
      k: 5,
      minScore: 0.15,
    });

    expect(chat.calls).toHaveLength(1);
    const prompt = chat.calls[0]!.user;
    expect(prompt).toContain("billing.md");
    // The zero-scoring documents were retrieved but must not be in the prompt.
    expect(prompt).not.toContain("shipping.md");
    expect(prompt).not.toContain("security.md");
    // Context block count matches the citation count.
    expect(prompt.match(/\[\d+\] \(source:/g)).toHaveLength(a.citations.length);
  });

  it("a stale citation is impossible: re-ingesting changed content moves the chunk id with the text", async () => {
    const e = offlineEngine();
    await ingest(
      [{ id: "policy", source: "policy", text: "Refunds take 14 days." }],
      e,
    );
    const before = await ask("How long do refunds take?", e);
    expect(before.grounded).toBe(true);
    expect(before.citations[0]!.snippet).toContain("14");

    await ingest(
      [{ id: "policy", source: "policy", text: "Refunds take 30 days." }],
      e,
    );
    const after = await ask("How long do refunds take?", e);
    expect(await e.store.count()).toBe(1); // old chunk pruned, not orphaned
    expect(after.citations[0]!.snippet).toContain("30");
    expect(after.citations[0]!.snippet).not.toContain("14");
    expect(after.retrieved[0]!.contentHash).toBe(sha256("Refunds take 30 days."));
  });

  it("a refusal carries no citations at all (nothing to cite → cite nothing)", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);
    const a = await ask("What is the airspeed velocity of an unladen swallow?", e);
    expect(a.grounded).toBe(false);
    expect(a.citations).toEqual([]);
  });
});
