import { describe, it, expect } from "vitest";
import { ingest, ask } from "../src/core/pipeline";
import { loadDocsFromDir } from "../src/core/load";
import { offlineEngine, docsDir } from "./helpers";

describe("ingest + ask (offline)", () => {
  it("embeds all chunks first run, then skips unchanged (idempotent)", async () => {
    const e = offlineEngine();
    const docs = loadDocsFromDir(docsDir);

    const first = await ingest(docs, e);
    expect(first.embedded).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);
    expect(await e.store.count()).toBe(first.embedded);

    const again = await ingest(docs, e);
    expect(again.embedded).toBe(0); // nothing re-embedded
    expect(again.skipped).toBe(first.embedded);
  });

  it("re-embeds changed content and prunes stale chunks when a doc shrinks", async () => {
    const e = offlineEngine();
    // A long doc → several chunks (distinct content → distinct hashes).
    const longText = Array.from(
      { length: 80 },
      (_, i) => `Section ${i} discusses unique topic w${i} in detail here.`,
    ).join(" ");
    const first = await ingest([{ id: "x", source: "x", text: longText }], e);
    expect(first.embedded).toBeGreaterThan(1); // multiple chunks

    // Replace with a short doc → 1 chunk; the rest must be pruned.
    const r = await ingest(
      [{ id: "x", source: "x", text: "A short replacement document." }],
      e,
    );
    expect(r.embedded).toBeGreaterThan(0);
    expect(r.pruned).toBeGreaterThan(0);
    expect(await e.store.count()).toBe(1);
  });

  it("answers a grounded question with citations to the right source", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);

    const a = await ask("How do refunds work and how do I cancel my subscription?", e);
    expect(a.grounded).toBe(true);
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.citations.some((c) => c.source === "billing.md")).toBe(true);
    expect(a.retrieved[0]!.source).toBe("billing.md");
    expect(a.answer.toLowerCase()).toContain("14");
  });
});
