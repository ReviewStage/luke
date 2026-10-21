import type {
  AutomationChangeParams,
  AutomationCreateParams,
  AutomationDeletedView,
  AutomationFollow,
  AutomationFollowed,
  AutomationIdParams,
  AutomationListParams,
  AutomationListView,
  AutomationRunParams,
  AutomationRunsView,
  AutomationRunView,
  AutomationView,
} from "@luke/features/automation-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { AUTOMATION_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * automation-procedures.ts -- the Automations pages' asks of the host about the account's automations.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Automations pages, so every one refuses the takeover and the hidden voice
 * window, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. A follow is a stream the panel
 * holds open while it draws a workspace's automations or an automation's
 * runs: the host follows it from the first stream of it to the last, and
 * every change reaches every stream of it. Nothing else is held here.
 */
export interface AutomationProceduresDependencies {
  host: {
    automationList(params: AutomationListParams): Effect.Effect<AutomationListView>;
    automationCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
    automationChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
    automationDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
    automationRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
    automationRuns(params: AutomationIdParams): Effect.Effect<AutomationRunsView>;
    automationNewWebhookSecret(params: AutomationIdParams): Effect.Effect<AutomationView>;
    /** What a panel draws followed from now, as it stands and each time it moves, heard through `onAutomationsChanged`; following again starts over. */
    automationsFollow(scope: AutomationFollow): Effect.Effect<void>;
    automationsUnfollow(scope: AutomationFollow): Effect.Effect<void>;
    onAutomationsChanged(listener: (followed: AutomationFollowed) => void): () => void;
  };
}

/** The refusal a window that draws no Automations page hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function automationProcedures(dependencies: AutomationProceduresDependencies) {
  const { host } = dependencies;
  /** How many streams stand open of each list or history, so the host lets one go only with the last. */
  const openFollows: OpenFollows<AutomationFollowed["view"]> = MutableHashMap.empty();
  return {
    [AUTOMATION_ACT_KIND.AUTOMATIONS_LIST]: actPort[AUTOMATION_ACT_KIND.AUTOMATIONS_LIST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.automationList(input);
      },
    ),
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
    [AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS]: actPort[AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.automationRuns(input);
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
      const views = followedStream(
        {
          keyOf: (scope: AutomationFollow) => `${scope.kind}:${scope.id}`,
          follow: host.automationsFollow,
          unfollow: host.automationsUnfollow,
          onChanged: host.onAutomationsChanged,
          valueOf: (changed: AutomationFollowed, scope: AutomationFollow) =>
            changed.scope.kind === scope.kind && changed.scope.id === scope.id
              ? Option.some(changed.view)
              : Option.none(),
        },
        openFollows,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(views));
    }),
  };
}
