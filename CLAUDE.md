# CLAUDE.md — grounded (RAG starter · Exavel lead-magnet #1)

Production-grade RAG starter. Provider/store-agnostic, **fully offline-testable**. Part of the Exavel freelance plan (inbound magnet + reusable client code). Parent context: [../CLAUDE.md](../CLAUDE.md).

## Layout
- `src/core/` — `pipeline.ts` (ingest + ask), `chunk.ts`, `hash.ts`, `rank.ts`, `retry.ts`, `types.ts`, `load.ts`
- `src/embedders/` — `hash.ts` (offline, 4096-dim, stopword-filtered) + `openai.ts`
- `src/stores/` — `memory.ts` (default) + `pgvector.ts` (+ `pgvector-migrate.ts`)
- `src/llm/` — `openai.ts` + `offline.ts` (extractive, no key)
- `src/eval/run.ts` + `eval/dataset.json` — eval harness
- `src/server.ts` (Fastify), `src/cli/{ingest,ask,eval}.ts`, `src/config.ts` (env-driven)

## Reliability selling points (the pitch)
idempotent ingest (sha256 content-hash dedup + prune) · retries/backoff (`withRetry`) · cited answers · **"I don't know" guardrail** (`RAG_MIN_SCORE`, model not called on refusal) · eval harness for CI.

## Verify (offline, no key/DB)
```
npm run typecheck && npm test && npm run eval   # 10 tests, eval 4/4
npm start   # zero-setup demo server (offline)
```
## Production
`PROVIDER=openai STORE=pgvector` + `docker compose up -d` (pgvector/pgvector:pg16) + `npm run migrate`. Honors `OPENAI_BASE_URL` (Azure/proxies).

## Status
Built + verified 2026-06-12. To publish: `gh repo create`. Then share on X (see ../EXAVEL/content-calendar.md) + pin on GitHub.
