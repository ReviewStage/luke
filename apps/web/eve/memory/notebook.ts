import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import { Effect } from "effect";
import { defineMemory, defineMemoryProvider } from "eve/memory";
import { actedForAccount } from "../../server/hosted/brain-host/auth.js";
import { productionBrainHostSeams } from "../../server/hosted/brain-host/production.js";
import { runWeb } from "../../server/runtime.js";
import { host } from "../host.js";
import { scriptedModel } from "../scripted-model.js";

/**
 * Luke's notebook as eve's memory slot, declared for one thing: the
 * pre-compaction memory flush. eve calls a slot's `compaction.requested`
 * capture, awaited, with a private copy of the history before it folds the
 * session's context, and that is the one moment OpenClaw's housekeeping turn
 * runs; the host decides the rest — whose conversation, what kind of turn,
 * which model, whether this cycle already flushed — and writes the outcome
 * on the conversation's row. The slot recalls nothing and offers the model no
 * tool of its own: what Luke remembers reaches him through the workspace
 * rows his prompt is composed from, and the flush writes those rows through
 * the same `append_daily_note` his turns hold. The slot's scope is the
 * account the session acts for, so eve locks the slot per account and a
 * session with no account is one the slot is disabled for. A flush that
 * could not run is reported and the compaction proceeds: nothing here may
 * fail the developer's turn.
 */

const seams = productionBrainHostSeams(runWeb);

export default defineMemory({
  scope: (context) => actedForAccount(context.session.auth.current) ?? null,
  provider: defineMemoryProvider({
    recall: {
      "turn.started": () => null,
    },
    capture: {
      "compaction.requested": (capture) =>
        runWeb(
          catchAllButInterrupt(
            host.flush(capture, seams.scriptedModel() ? scriptedModel() : undefined),
            (cause) => Effect.logWarning("The memory flush could not be run", cause),
          ),
        ).then(() => undefined),
    },
  }),
});
