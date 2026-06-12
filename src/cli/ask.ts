import { buildEngine } from "../config";
import { ask } from "../core/pipeline";

// Usage: npm run ask -- "your question"
// Reads from the store, so run `npm run ingest` first with STORE=pgvector.
async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run ask -- "your question"');
    process.exit(1);
  }
  const engine = buildEngine();
  const answer = await ask(question, engine);

  console.log(`\nQ: ${question}\n`);
  console.log(`A: ${answer.answer}\n`);
  console.log(answer.grounded ? "Citations:" : "(refused — no relevant sources)");
  for (const c of answer.citations) {
    console.log(`  [${c.source}] score=${c.score.toFixed(2)} — ${c.snippet.slice(0, 80)}…`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
