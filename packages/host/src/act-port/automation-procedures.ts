import type { AutomationFollow } from "@repo/features/automation-view";
import { Effect, MutableHashMap, Stream } from "effect";
import { AUTOMATION_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * automation-procedures.ts -- the Automations pages' holds on the account's automations, each followed and asked again.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Automations pages, so every one refuses the takeover, in its own sentence.
 * The plain asks are declared (`contract/automations.ts`) and answered by
 * the automations' composer. A hold is a stream the panel
 * holds open while it draws a workspace's automations, its runs, or an
 * automation's runs: the host holds the read from the first stream of it
 * and lets it go with the last, and what it holds reaches every panel on
 * app state, never down the stream, which carries nothing. How many
 * streams stand open of each is all else held here.
 */
export interface AutomationProceduresDependencies {
  host: {
    /** A list or history held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    automationsFollow(scope: AutomationFollow): Effect.Effect<void>;
    automationsUnfollow(scope: AutomationFollow): Effect.Effect<void>;
    /** A held list or history read again at once, as Try again asks. */
    automationsRetry(scope: AutomationFollow): Effect.Effect<void>;
  };
}

/** The refusal a window that draws no Automations page hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function automationProcedures(dependencies: AutomationProceduresDependencies) {
  const { host } = dependencies;
  /** How many streams stand open of each list or history, so the host lets one go only with the last. */
  const openHolds: OpenFollows<Pick<AutomationFollow, "kind" | "id">> = MutableHashMap.empty();
  return {
    [AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (scope: AutomationFollow) => ({ kind: scope.kind, id: scope.id }),
          follow: host.automationsFollow,
          unfollow: host.automationsUnfollow,
        },
        openHolds,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_RETRY]: actPort[AUTOMATION_ACT_KIND.AUTOMATIONS_RETRY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.automationsRetry(input);
      },
    ),
  };
}
