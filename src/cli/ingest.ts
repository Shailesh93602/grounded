import { buildEngine } from "../config";
import { ingest } from "../core/pipeline";
import { loadDocsFromDir } from "../core/load";

// Usage: npm run ingest -- <dir>   (defaults to examples/docs)
// Note: persists only with STORE=pgvector (memory store is per-process).
async function main(): Promise<void> {
  const dir = process.argv[2] ?? "examples/docs";
  const engine = buildEngine();
  const docs = loadDocsFromDir(dir);
  const result = await ingest(docs, engine);
  console.log(`✓ ingested from ${dir}:`, result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
