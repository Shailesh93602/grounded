import type { Chat } from "../core/types";

/**
 * Offline, no-API-key chat for zero-setup demos and tests. It doesn't call an
 * LLM — it returns an *extractive* answer (the most relevant retrieved passage)
 * and labels itself honestly. Swap to OpenAIChat for real generative answers.
 */
export class ExtractiveChat implements Chat {
  readonly id = "offline-extractive";

  async complete(_system: string, user: string) {
    const match = user.match(
      /\[1\] \(source:[^)]*\)\n([\s\S]*?)(?:\n\n\[2\]|\n\nQuestion:|$)/,
    );
    const body = match?.[1]?.trim() ?? "";
    const text = body
      ? `Based on the sources: ${body} [1]\n\n(offline extractive mode — set PROVIDER=openai for generated answers)`
      : "I don't know based on the provided sources.";
    return { text };
  }
}
