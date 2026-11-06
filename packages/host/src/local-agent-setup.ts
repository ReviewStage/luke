import type { AgentToolPin } from "@repo/agent-runner/pins";
import { Effect, Option } from "effect";
import { type LocalAgentClis, LocalAgentClisUnavailable } from "./effect/seams.js";
import { keptToolBinary, localAgentTool } from "./local-agent-tools.js";

const SETUP_FAILURE = {
  CLAUDE_CODE: "Claude Code couldn't be downloaded or didn't pass its check",
  CODEX: "Codex couldn't be downloaded or didn't pass its check",
  GH: "GitHub's CLI couldn't be downloaded or didn't pass its check",
} as const;

export interface AgentCliPins {
  readonly claude: AgentToolPin;
  readonly codex: AgentToolPin;
  readonly gh: AgentToolPin;
}

export function localAgentClis(stateRoot: string, pins: AgentCliPins): LocalAgentClis {
  const wanted = [
    { pin: pins.claude, failure: SETUP_FAILURE.CLAUDE_CODE },
    { pin: pins.codex, failure: SETUP_FAILURE.CODEX },
    { pin: pins.gh, failure: SETUP_FAILURE.GH },
  ];
  return {
    paths: {
      claude: keptToolBinary(stateRoot, pins.claude),
      codex: keptToolBinary(stateRoot, pins.codex),
      gh: keptToolBinary(stateRoot, pins.gh),
    },
    ready: (preparing) =>
      Effect.gen(function* () {
        const once = yield* Effect.cached(preparing);
        for (const { pin, failure } of wanted) {
          const had = yield* localAgentTool(stateRoot, pin, once);
          if (Option.isNone(had)) {
            return yield* new LocalAgentClisUnavailable({ detail: failure });
          }
        }
      }),
  };
}
