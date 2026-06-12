import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "../src/core/pipeline";
import { loadDocsFromDir } from "../src/core/load";
import { runEval, type EvalCase } from "../src/eval/run";
import { offlineEngine, docsDir } from "./helpers";

describe("eval harness", () => {
  it("passes the bundled dataset offline (retrieval + guardrail + answers)", async () => {
    const e = offlineEngine();
    await ingest(loadDocsFromDir(docsDir), e);

    const cases: EvalCase[] = JSON.parse(
      readFileSync(join(docsDir, "..", "..", "eval", "dataset.json"), "utf8"),
    );
    const summary = await runEval(cases, e);

    expect(summary.passed).toBe(summary.total);
    expect(summary.retrievalHitRate).toBe(1);
  });
});
