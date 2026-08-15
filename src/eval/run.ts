import { ask, type AskOptions } from "../core/pipeline";

export interface EvalCase {
  question: string;
  /**
   * The answer should be *grounded in* this source — i.e. a chunk from it must
   * clear the guardrail and end up cited. Checked against citations, not the
   * raw top-k pull: on a small corpus a top-k pull returns every document, so
   * scoring against it would make the hit-rate trivially 100%.
   */
  expectSource?: string;
  /** should the guardrail allow an answer (true) or refuse (false)? */
  expectGrounded?: boolean;
  /** answer must contain these substrings (case-insensitive) */
  expectAnswerIncludes?: string[];
}

export interface EvalCaseResult {
  question: string;
  grounded: boolean;
  topScore: number;
  retrievalHit: boolean;
  groundedOk: boolean;
  answerHit: boolean;
  pass: boolean;
}

export interface EvalSummary {
  total: number;
  passed: number;
  retrievalHitRate: number;
  results: EvalCaseResult[];
}

/**
 * Run a labelled Q&A set through the pipeline and score it. Catches regressions
 * (a prompt/model/chunking change that silently makes retrieval or answers
 * worse) — run it in CI on every change.
 */
export async function runEval(
  cases: EvalCase[],
  opts: AskOptions,
): Promise<EvalSummary> {
  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    const a = await ask(c.question, opts);
    const retrievalHit = c.expectSource
      ? a.citations.some((cit) => cit.source === c.expectSource)
      : true;
    const groundedOk =
      c.expectGrounded === undefined || a.grounded === c.expectGrounded;
    const answerHit = c.expectAnswerIncludes
      ? c.expectAnswerIncludes.every((s) =>
          a.answer.toLowerCase().includes(s.toLowerCase()),
        )
      : true;
    results.push({
      question: c.question,
      grounded: a.grounded,
      topScore: a.retrieved[0]?.score ?? 0,
      retrievalHit,
      groundedOk,
      answerHit,
      pass: retrievalHit && groundedOk && answerHit,
    });
  }
  const passed = results.filter((r) => r.pass).length;
  const withSource = cases.filter((c) => c.expectSource).length;
  const retrievalHits = cases.filter(
    (c, i) => c.expectSource && results[i]!.retrievalHit,
  ).length;
  return {
    total: cases.length,
    passed,
    retrievalHitRate: withSource ? retrievalHits / withSource : 1,
    results,
  };
}
