import Fastify from "fastify";
import { z } from "zod";
import { buildEngine } from "./config";
import { ingest, ask } from "./core/pipeline";

const engine = buildEngine();
const app = Fastify({ logger: true });

const ingestBody = z.object({
  docs: z
    .array(
      z.object({
        id: z.string().min(1),
        source: z.string().optional(),
        text: z.string().min(1),
      }),
    )
    .min(1),
});

app.post("/ingest", async (req, reply) => {
  const parsed = ingestBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const docs = parsed.data.docs.map((d) => ({
    id: d.id,
    source: d.source ?? d.id,
    text: d.text,
  }));
  return ingest(docs, engine);
});

const askBody = z.object({
  question: z.string().min(1),
  k: z.number().int().positive().optional(),
  minScore: z.number().optional(),
});

app.post("/ask", async (req, reply) => {
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return ask(parsed.data.question, {
    embedder: engine.embedder,
    store: engine.store,
    chat: engine.chat,
    k: parsed.data.k ?? engine.k,
    minScore: parsed.data.minScore ?? engine.minScore,
  });
});

app.get("/stats", async () => ({
  chunks: await engine.store.count(),
  embedder: engine.embedder.id,
  chat: engine.chat.id,
}));

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`grounded listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
