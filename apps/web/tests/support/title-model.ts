// title-model.ts -- a scripted stand-in for the small model a coding agent's or a subagent's title is generated on.
import { MockLanguageModelV4 } from "ai/test";

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A title model answering from a script, each call the next line; one that throws is the provider down. */
export function titleModelAnswering(answers: readonly (string | Error)[]): MockLanguageModelV4 {
  const queue = [...answers];
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const answer = queue.shift() ?? "";
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text" as const, text: answer }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}
