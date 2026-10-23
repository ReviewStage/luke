import {
  chatGptSignInAnswerViewSchema,
  dictationTranscribeAnswerViewSchema,
  dictationTranscribeParamsSchema,
  githubTokenAnswerViewSchema,
  githubTokenSaveParamsSchema,
  memoriesAnswerViewSchema,
  memoriesReadParamsSchema,
  memoryForgetParamsSchema,
  planTemplateAnswerViewSchema,
  planTemplateRevisionAnswerViewSchema,
  planTemplateRevisionParamsSchema,
  planTemplateRevisionsAnswerViewSchema,
  planTemplateRevisionsParamsSchema,
  planTemplateWriteParamsSchema,
  providerKeyForAgentsParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
  providerKeysAnswerViewSchema,
} from "@luke/features/coding-agent-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { ACCOUNT_ASK_ACT_KIND } from "./kinds.js";

/**
 * account-asks.ts -- the account's own asks of the host from Settings and a dictating box, as procedures.
 *
 * A kind that carries nothing takes `undefined` alone, so a window calls it
 * with no payload and one sent anything is refused.
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, as the agent acts' do.
 */
export const accountAskActsContract = {
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_READ]: actProcedure(
    "Could not read your API keys on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(providerKeysAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE]: actProcedure(
    "Could not save your API key on this system.",
  )
    .input(exactInput(providerKeySaveParamsSchema))
    .output(EffectSchema.flip(providerKeysAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE]: actProcedure(
    "Could not remove your API key on this system.",
  )
    .input(exactInput(providerKeyRemoveParamsSchema))
    .output(EffectSchema.flip(providerKeysAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOR_AGENTS]: actProcedure(
    "Could not change your plan's default on this system.",
  )
    .input(exactInput(providerKeyForAgentsParamsSchema))
    .output(EffectSchema.flip(providerKeysAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN]: actProcedure(
    "Could not sign in with ChatGPT on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(chatGptSignInAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN_CANCEL]: actProcedure(
    "Could not cancel the ChatGPT sign-in on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_READ]: actProcedure(
    "Could not read your GitHub token on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(githubTokenAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_SAVE]: actProcedure(
    "Could not save your GitHub token on this system.",
  )
    .input(exactInput(githubTokenSaveParamsSchema))
    .output(EffectSchema.flip(githubTokenAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_REMOVE]: actProcedure(
    "Could not remove your GitHub token on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(githubTokenAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.MEMORIES_READ]: actProcedure("Could not read Luke's memory on this system.")
    .input(exactInput(memoriesReadParamsSchema))
    .output(EffectSchema.flip(memoriesAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.MEMORIES_FORGET]: actProcedure(
    "Could not forget that memory on this system.",
  )
    .input(exactInput(memoryForgetParamsSchema))
    .output(EffectSchema.flip(memoriesAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_READ]: actProcedure(
    "Could not read your plan template on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(planTemplateAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_WRITE]: actProcedure(
    "Could not save your plan template on this system.",
  )
    .input(exactInput(planTemplateWriteParamsSchema))
    .output(EffectSchema.flip(planTemplateAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISIONS]: actProcedure(
    "Could not read your plan template's history on this system.",
  )
    .input(exactInput(planTemplateRevisionsParamsSchema))
    .output(EffectSchema.flip(planTemplateRevisionsAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISION]: actProcedure(
    "Could not read that version on this system.",
  )
    .input(exactInput(planTemplateRevisionParamsSchema))
    .output(EffectSchema.flip(planTemplateRevisionAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_RESTORE]: actProcedure(
    "Could not restore that version on this system.",
  )
    .input(exactInput(planTemplateRevisionParamsSchema))
    .output(EffectSchema.flip(planTemplateAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE]: actProcedure(
    "Could not transcribe the recording on this system.",
  )
    .input(exactInput(dictationTranscribeParamsSchema))
    .output(EffectSchema.flip(dictationTranscribeAnswerViewSchema)),
};
