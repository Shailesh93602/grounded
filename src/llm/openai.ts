import OpenAI from "openai";
import type { Chat } from "../core/types";
import { withRetry } from "../core/retry";

/** Production chat model. Honors a custom baseURL (Azure / proxies / compatible APIs). */
export class OpenAIChat implements Chat {
  readonly id: string;
  private client: OpenAI;
  private model: string;

  constructor(opts: { apiKey: string; baseURL?: string; model?: string }) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model ?? "gpt-4o-mini";
    this.id = `openai:${this.model}`;
  }

  async complete(system: string, user: string) {
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    );
    const text = res.choices[0]?.message?.content ?? "";
    const usage = res.usage
      ? {
          inputTokens: res.usage.prompt_tokens,
          outputTokens: res.usage.completion_tokens,
        }
      : undefined;
    return { text, usage };
  }
}
