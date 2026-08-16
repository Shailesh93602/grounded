# Grounded

[![CI](https://github.com/Shailesh93602/grounded/actions/workflows/ci.yml/badge.svg)](https://github.com/Shailesh93602/grounded/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> A production-grade **RAG starter** that answers from *your* sources, **cites them**, and says **"I don't know"** instead of hallucinating.

Most RAG demos look great until real users hit them — then they hallucinate, double-charge on retries, re-embed everything on every deploy, and you have no way to tell if a prompt change made things worse. **Grounded** is the boring, reliable parts done right, in a small codebase you can read in 20 minutes and ship on.

- ✅ **Cited answers** — every answer references the source chunks it used.
- ✅ **"I don't know" guardrail** — if nothing relevant is retrieved, it refuses instead of guessing.
- ✅ **Idempotent ingestion** — only new/changed chunks get embedded (content-hash dedup); re-ingesting is a near-no-op. No wasted API spend.
- ✅ **Retries with backoff** — transient API errors retried; 4xx fail fast.
- ✅ **Eval harness** — a labelled Q&A set scores retrieval + answers, so you catch regressions in CI.
- ✅ **Pluggable + offline-testable** — swap embedder/store/LLM via env; the default runs with **no API key and no database** (great for demos, tests, and CI).

Stack: TypeScript · Fastify · Postgres + pgvector · OpenAI (swappable).

---

## Quick start (zero setup — no API key, no DB)

```bash
npm install
npm start            # offline mode: in-memory store + extractive answers
```
```bash
# ingest some docs
curl -XPOST localhost:3000/ingest -H 'content-type: application/json' \
  -d '{"docs":[{"id":"faq","source":"faq.md","text":"Refunds are allowed within 30 days."}]}'

# ask — grounded answer with citations
curl -XPOST localhost:3000/ask -H 'content-type: application/json' \
  -d '{"question":"What is the refund window?"}'

# ask something off-topic — it refuses instead of making things up
curl -XPOST localhost:3000/ask -H 'content-type: application/json' \
  -d '{"question":"How do I train a neural net?"}'   # → grounded:false
```

Run the eval + tests:
```bash
npm run eval         # scores the bundled Q&A set (offline)
npm test             # 41 tests, no API key / DB needed
npm run check        # everything CI runs: typecheck + tests + eval
```

Exercise the **pgvector** store too (9 extra tests, needs Docker):
```bash
docker compose up -d
GROUNDED_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/grounded npm test
```

## Production (OpenAI + pgvector)

```bash
cp .env.example .env
# set PROVIDER=openai, STORE=pgvector, OPENAI_API_KEY=..., DATABASE_URL=...
docker compose up -d            # Postgres with pgvector
npm run migrate                 # create the vector table + cosine index
npm run ingest -- ./your-docs   # embed your corpus (idempotent)
npm start
```
Every `npm run` script loads `.env` automatically (`--env-file-if-exists`, Node ≥20.12).
Works with Azure OpenAI / proxies via `OPENAI_BASE_URL`.

> `npm run ingest` only persists with `STORE=pgvector` — the memory store lives
> and dies with the process, so ingest via the running server's `/ingest` when
> you're in the zero-setup default.

---

## How the reliability works

**Idempotent ingestion** (`src/core/pipeline.ts`): each chunk is keyed by a sha256 of its text. On ingest we embed only chunks whose hash isn't already stored, and prune chunks that no longer exist. Change one paragraph → only that chunk re-embeds.

**The guardrail** (`ask()`): we retrieve top-`k`, and if the best cosine similarity is below `RAG_MIN_SCORE`, we return a refusal — the model is never even called, so it can't hallucinate (and you don't pay for it).

**Citations**: the answer ships with the exact source chunks + scores it was built from, so users (and you) can verify it. Only chunks that clear `minScore` are cited — and those are exactly the chunks put in front of the model, so the citation list is what the answer was actually built from, not the whole top-`k` pull.

**Evals** (`src/eval/run.ts`): a JSON dataset of questions with expected sources / grounded-ness / answer substrings. `npm run eval` scores retrieval hit-rate and answer correctness — run it in CI to catch regressions from a prompt/model/chunking change. Retrieval is scored against the **cited** chunks, not the raw top-`k`: on a small corpus top-`k` returns every document, which would make the hit-rate trivially 100%.

## Architecture (swap any piece)

```
ingest/ask  →  Embedder        ×  VectorStore     ×  Chat
               ├ OpenAI (prod)    ├ pgvector (prod)   ├ OpenAI (prod)
               └ Hash (offline)   └ Memory (offline)  └ Extractive (offline)
```
Same pipeline code regardless — only the adapters change. That's why the whole thing is testable offline.

## API
| Method | Path | |
|---|---|---|
| POST | `/ingest` | `{ docs: [{id, source?, text}] }` → ingest summary |
| POST | `/ask` | `{ question, k?, minScore? }` → `{ answer, citations, grounded }` |
| GET | `/stats` | chunk count + active providers |
| GET | `/health` | liveness |

---

## Why this exists / who built it
Built by **[Exavel](https://github.com/Shailesh93602)** — we build AI features that hold up in production. If your AI feature is flaky, hallucinating, or expensive, that's what we do. (See also [Holdfast](https://github.com/Shailesh93602/holdfast), an oversell-proof, chaos-tested reservation engine.)

MIT licensed — use it, fork it, ship it.
