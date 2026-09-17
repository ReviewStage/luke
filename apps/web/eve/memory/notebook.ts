import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import { Effect } from "effect";
import { defineMemory, defineMemoryProvider } from "eve/memory";
import { actedForAccount } from "../../server/hosted/brain-host/auth.js";
import { runWeb } from "../../server/runtime.js";
import { host, seams } from "../host.js";
import { scriptedModel } from "../scripted-model.js";

/**
 * Luke's notebook as eve's memory slot, declared for two things. The recall:
 * eve calls `turn.started` before every turn, and the host answers it once,
 * into a session opening on an empty history, with the account's notes for
 * today and yesterday rendered by the notebook's own provider, as OpenClaw
 * loads them at session start; an ongoing history, an unadmitted session,
 * or an account with no recent note gets nothing. The capture: eve calls
 * `compaction.requested`, awaited, with a private copy of the history before
 * it folds the session's context, and that is the one moment OpenClaw's
 * housekeeping turn runs; the host decides the rest — whose conversation,
 * what kind of turn, which model, whether this cycle already flushed — and
 * writes the outcome on the conversation's row. The slot offers the model no
 * tool of its own: the curated files reach Luke through the workspace rows
 * his prompt is composed from, and the flush writes the notes through the
 * same `append_daily_note` his turns hold. The slot's scope is the account
 * the session acts for, so eve locks the slot per account and a session with
 * no account is one the slot is disabled for. Both are total on the host's
 * side: a recall or a flush that could not run is reported there and the
 * turn proceeds, since nothing here may fail the developer's turn.
 */

export default defineMemory({
  scope: (context) => actedForAccount(context.session.auth.current) ?? null,
  provider: defineMemoryProvider({
    recall: {
      "turn.started": (context) => runWeb(host.recall(context)),
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
