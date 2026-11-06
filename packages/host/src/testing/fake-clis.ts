import { Effect } from "effect";
import type { LocalAgentClis } from "../effect/seams.js";

export function fakeClis(ready: LocalAgentClis["ready"] = () => Effect.void): LocalAgentClis {
  return {
    paths: {
      claude: "/opt/agent/agent-tools/claude",
      codex: "/opt/agent/agent-tools/codex",
      gh: "/opt/agent/agent-tools/gh",
    },
    ready,
  };
}
