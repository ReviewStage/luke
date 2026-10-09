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
 * call, notes whose stream breaks off with an error halfway through, a
 * stream that opens and never says another word, or notes streamed one chunk
 * each time the test calls `pace`.
 */
export type ScribeAnswer =
  | ScribeNotes
  | Error
  | { readonly brokenAfter: ScribeNotes }
  | { readonly stalls: true }
  | { readonly paced: ScribeNotes };

/** The notes one answer takes, as the model emits them. */
interface ScribeNotes {
  readonly notes: readonly PlanNote[];
}

/** The stream parts one answer is sent as, the JSON split a few characters at a time. */
function chunksOf(answer: ScribeNotes | { readonly brokenAfter: ScribeNotes }) {
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
  return [
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "answer" },
    ...deltas.map((delta) => ({ type: "text-delta" as const, id: "answer", delta })),
    ...ending,
  ];
}

type ScribeChunk = ReturnType<typeof chunksOf>[number];

/** A paced answer's chunks not yet sent, and the stream they are sent on once the call opens it. */
interface PacedStream {
  chunks: ScribeChunk[];
  controller?: ReadableStreamDefaultController<ScribeChunk>;
}

/**
 * A model answering each call with the next scripted answer, streamed as the
 * provider would stream it, a few characters of JSON at a time, and keeping
 * what each call was handed. A call past the script answers no notes. `pace`
 * sends a paced answer's next chunk and answers whether one was left to send,
 * so a test sets when each chunk lands against its own clock.
 */
export function scriptedScribeModel(answers: readonly ScribeAnswer[]) {
  const asked: string[] = [];
  const paced: PacedStream = { chunks: [] };
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      asked.push(JSON.stringify(options.prompt));
      const answer: ScribeAnswer = answers[asked.length - 1] ?? { notes: [] };
      if (answer instanceof Error) throw answer;
      if ("stalls" in answer) return { stream: new ReadableStream() };
      if ("paced" in answer) {
        paced.chunks = chunksOf(answer.paced);
        return {
          stream: new ReadableStream<ScribeChunk>({
            start: (controller) => {
              paced.controller = controller;
            },
          }),
        };
      }
      return { stream: simulateReadableStream({ chunks: chunksOf(answer) }) };
    },
  });
  const pace = () => {
    const chunk = paced.chunks.shift();
    if (paced.controller === undefined || chunk === undefined) return false;
    paced.controller.enqueue(chunk);
    if (paced.chunks.length === 0) paced.controller.close();
    return true;
  };
  return { model, asked, pace };
}
