import type {
  DictationTranscribeAnswerView,
  DictationTranscribeParams,
  PlanTemplateAnswerView,
  PlanTemplateRevisionAnswerView,
  PlanTemplateRevisionParams,
  PlanTemplateRevisionsAnswerView,
  PlanTemplateRevisionsParams,
  PlanTemplateWriteParams,
  ProviderKeyRemoveParams,
  ProviderKeySaveParams,
  ProviderKeysAnswerView,
} from "@luke/features/coding-agent-view";
import { Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { ACCOUNT_ASK_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * account-ask-procedures.ts -- the account's own asks of the host from Settings and a dictating box.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings or records a clip, so every one refuses the takeover and the
 * hidden voice window, in its own sentence. A save's key and a dictated
 * clip each pass through to the host once and are noted nowhere, and what
 * the service answers comes back as the panel's own answer, or why there is
 * none. Nothing is held here.
 */
export interface AccountAskProceduresDependencies {
  host: {
    providerKeysRead(): Effect.Effect<ProviderKeysAnswerView>;
    providerKeySave(params: ProviderKeySaveParams): Effect.Effect<ProviderKeysAnswerView>;
    providerKeyRemove(params: ProviderKeyRemoveParams): Effect.Effect<ProviderKeysAnswerView>;
    planTemplateRead(): Effect.Effect<PlanTemplateAnswerView>;
    planTemplateWrite(params: PlanTemplateWriteParams): Effect.Effect<PlanTemplateAnswerView>;
    planTemplateRevisions(
      params: PlanTemplateRevisionsParams,
    ): Effect.Effect<PlanTemplateRevisionsAnswerView>;
    planTemplateRevision(
      params: PlanTemplateRevisionParams,
    ): Effect.Effect<PlanTemplateRevisionAnswerView>;
    planTemplateRestore(params: PlanTemplateRevisionParams): Effect.Effect<PlanTemplateAnswerView>;
    dictationTranscribe(
      params: DictationTranscribeParams,
    ): Effect.Effect<DictationTranscribeAnswerView>;
  };
}

/** The refusal a window that draws no Settings hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function accountAskProcedures(dependencies: AccountAskProceduresDependencies) {
  const { host } = dependencies;
  return {
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_READ]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_READ
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.providerKeysRead();
    }),
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.providerKeySave(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.providerKeyRemove(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_READ]: actPort[
      ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_READ
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.planTemplateRead();
    }),
    [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_WRITE]: actPort[
      ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_WRITE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.planTemplateWrite(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISIONS]: actPort[
      ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISIONS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.planTemplateRevisions(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISION]: actPort[
      ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.planTemplateRevision(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_RESTORE]: actPort[
      ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_RESTORE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.planTemplateRestore(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE]: actPort[
      ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.dictationTranscribe(input);
    }),
  };
}
