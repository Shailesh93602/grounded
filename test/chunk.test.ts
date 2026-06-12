import { describe, it, expect } from "vitest";
import { chunkText, chunkDoc } from "../src/core/chunk";
import { sha256 } from "../src/core/hash";

describe("chunking", () => {
  it("returns one chunk for short text and none for blank", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
    expect(chunkText("    ")).toEqual([]);
  });

  it("splits long text into overlapping, bounded, non-empty chunks", () => {
    const text = "lorem ipsum dolor ".repeat(400); // ~7200 chars
    const chunks = chunkText(text, { size: 1000, overlap: 150 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length > 0 && c.length <= 1001)).toBe(true);
  });

  it("chunkDoc produces stable ids and content hashes", () => {
    const chunks = chunkDoc({ id: "d1", source: "d1", text: "alpha beta gamma" });
    expect(chunks[0]!.id).toBe("d1#0");
    expect(chunks[0]!.docId).toBe("d1");
    expect(chunks[0]!.contentHash).toBe(sha256(chunks[0]!.text));
  });

  it("identical text hashes identically (the dedup key)", () => {
    expect(sha256("same text")).toBe(sha256("same text"));
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});
