import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildEngine } from "../config";
import { ingest } from "../core/pipeline";
import { loadDocsFromDir } from "../core/load";
import { runEval, type EvalCase } from "../eval/run";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main(): Promise<void> {
  const engine = buildEngine();
  const docs = loadDocsFromDir(join(root, "examples", "docs"));
  await ingest(docs, engine);

  const cases: EvalCase[] = JSON.parse(
    readFileSync(join(root, "eval", "dataset.json"), "utf8"),
  );
  const summary = await runEval(cases, engine);

  console.log(`\nGrounded eval — embedder=${engine.embedder.id}\n`);
  for (const r of summary.results) {
    console.log(
      `${r.pass ? "✓" : "✗"}  grounded=${String(r.grounded).padEnd(5)} top=${r.topScore.toFixed(2)}  ${r.question}`,
    );
  }
  console.log(
    `\n${summary.passed}/${summary.total} passed · retrieval hit-rate ${(summary.retrievalHitRate * 100).toFixed(0)}%\n`,
  );
  if (summary.passed < summary.total) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
