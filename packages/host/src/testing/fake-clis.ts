/**
 * fake-clis.ts -- the device's agent CLIs as a suite stands them in (`LocalAgentClis`): ready as the suite says, which a device registers and runs its agents on.
 */

import { Effect } from "effect";
import type { LocalAgentClis } from "../effect/seams.js";

/** The device's agent CLIs, had as `ready` says, at once and with nothing to fetch where the suite names none. */
export function fakeClis(ready: LocalAgentClis["ready"] = () => Effect.void): LocalAgentClis {
  return {
    paths: {
      claude: "/opt/luke/agent-tools/claude",
      codex: "/opt/luke/agent-tools/codex",
      gh: "/opt/luke/agent-tools/gh",
    },
    ready,
  };
}
