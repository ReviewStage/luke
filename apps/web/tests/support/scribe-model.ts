// scribe-model.ts -- a scripted stand-in for the model a planning call's notetaker streams its answer from.
import type { PlanNote } from "@sidecar/hosted/plan-template";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** How many characters of the answer's JSON each streamed delta carries, so a draft is read mid-answer. */
const DELTA_CHARS = 12;

/**
 * What the scripted model answers one call with: notes, a failure of the
 * call, notes whose stream breaks off with an error halfway through, or a
 * stream that opens and never says another word.
 */
export type ScribeAnswer =
  | ScribeNotes
  | Error
  | { readonly brokenAfter: ScribeNotes }
  | { readonly stalls: true };

/** The notes one answer takes, as the model emits them. */
interface ScribeNotes {
  readonly notes: readonly PlanNote[];
}

/**
 * A model answering each call with the next scripted answer, streamed as the
 * provider would stream it, a few characters of JSON at a time, and keeping
 * what each call was handed. A call past the script answers no notes.
 */
export function scriptedScribeModel(answers: readonly ScribeAnswer[]) {
  const asked: string[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      asked.push(JSON.stringify(options.prompt));
      const answer: ScribeAnswer = answers[asked.length - 1] ?? { notes: [] };
      if (answer instanceof Error) throw answer;
      if ("stalls" in answer) return { stream: new ReadableStream() };
      const broken = "brokenAfter" in answer;
      const whole = JSON.stringify(broken ? answer.brokenAfter : answer);
      const text = broken ? whole.slice(0, Math.ceil(whole.length / 2)) : whole;
      const deltas: string[] = [];
      for (let at = 0; at < text.length; at += DELTA_CHARS) {
        deltas.push(text.slice(at, at + DELTA_CHARS));
      }
      const ending = broken
        ? [{ type: "error" as const, error: new Error("the stream broke off") }]
        : [
            { type: "text-end" as const, id: "answer" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage: USAGE,
            },
          ];
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "answer" },
            ...deltas.map((delta) => ({ type: "text-delta" as const, id: "answer", delta })),
            ...ending,
          ],
        }),
      };
    },
  });
  return { model, asked };
}
