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

export interface AutomationProceduresDependencies {
  host: {
    automationCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
    automationChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
    automationDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
    automationRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
    automationNewWebhookSecret(params: AutomationIdParams): Effect.Effect<AutomationView>;
    automationsFollow(scope: AutomationFollow): Effect.Effect<void>;
    automationsUnfollow(scope: AutomationFollow): Effect.Effect<void>;
    automationsRetry(scope: AutomationFollow): Effect.Effect<void>;
  };
}

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function automationProcedures(dependencies: AutomationProceduresDependencies) {
  const { host } = dependencies;
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
