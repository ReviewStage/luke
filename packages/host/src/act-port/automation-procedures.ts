import type {
  AutomationChangeParams,
  AutomationCreateParams,
  AutomationDeletedView,
  AutomationFollow,
  AutomationIdParams,
  AutomationRunParams,
  AutomationRunView,
  AutomationView,
} from "@repo/features/automation-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { AUTOMATION_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * automation-procedures.ts -- the Automations pages' asks of the host about the account's automations.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Automations pages, so every one refuses the takeover, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. A hold is a stream the panel
 * holds open while it draws a workspace's automations, its runs, or an
 * automation's runs: the host holds the read from the first stream of it
 * and lets it go with the last, and what it holds reaches every panel on
 * app state, never down the stream, which carries nothing. How many
 * streams stand open of each is all else held here.
 */
export interface AutomationProceduresDependencies {
  host: {
    automationCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
    automationChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
    automationDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
    automationRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
    automationNewWebhookSecret(params: AutomationIdParams): Effect.Effect<AutomationView>;
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
  const openHolds: OpenFollows<
    never,
    Pick<AutomationFollow, "kind" | "id">
  > = MutableHashMap.empty();
  return {
    [AUTOMATION_ACT_KIND.AUTOMATIONS_CREATE]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_CREATE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationCreate(input);
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationChange(input);
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationDelete(input);
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_RUN]: actPort[AUTOMATION_ACT_KIND.AUTOMATIONS_RUN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.automationRun(input);
      },
    ),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationNewWebhookSecret(input);
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that nothing is heard down the hold, since the held read reaches the panel on app state.
      const hold = followedStream(
        {
          keyOf: (scope: AutomationFollow) => ({ kind: scope.kind, id: scope.id }),
          follow: host.automationsFollow,
          unfollow: host.automationsUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
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
