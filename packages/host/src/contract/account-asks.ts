import { eventIterator, type } from "@orpc/contract";
import {
  chatGptSignInAnswerViewSchema,
  dictationTranscribeAnswerViewSchema,
  dictationTranscribeParamsSchema,
  githubTokenAnswerViewSchema,
  githubTokenSaveParamsSchema,
  memoriesAnswerViewSchema,
  memoriesFollowParamsSchema,
  memoryForgetParamsSchema,
  providerKeyForAgentsParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
  providerKeysAnswerViewSchema,
} from "@repo/features/agent-view";
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
  // Note that the hold's stream carries nothing: the held keys reach the panel on app state, and the stream is the window's hold on them.
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW]: actProcedure(
    "Couldn't follow your API keys on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<never>())),
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_RETRY]: actProcedure(
    "Couldn't read your API keys again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE]: actProcedure(
    "Couldn't save your API key on this system.",
  )
    .input(exactInput(providerKeySaveParamsSchema))
    .output(EffectSchema.flip(providerKeysAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE]: actProcedure(
    "Couldn't remove your API key on this system.",
  )
    .input(exactInput(providerKeyRemoveParamsSchema))
    .output(EffectSchema.flip(providerKeysAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOR_AGENTS]: actProcedure(
    "Couldn't change your plan's default on this system.",
  )
    .input(exactInput(providerKeyForAgentsParamsSchema))
    .output(EffectSchema.flip(providerKeysAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN]: actProcedure(
    "Couldn't continue with ChatGPT on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(chatGptSignInAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN_CANCEL]: actProcedure(
    "Couldn't stop waiting for ChatGPT on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing: the held token reaches the panel on app state, and the stream is the window's hold on it.
  [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW]: actProcedure(
    "Could not follow your GitHub token on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<never>())),
  [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_RETRY]: actProcedure(
    "Could not read your GitHub token again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
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
  // Note that the hold's stream carries nothing: the held memories reach the panel on app state, and the stream is the window's hold on them.
  [ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW]: actProcedure(
    "Could not follow the workspace's memory on this system.",
  )
    .input(exactInput(memoriesFollowParamsSchema))
    .output(eventIterator(type<never>())),
  [ACCOUNT_ASK_ACT_KIND.MEMORIES_RETRY]: actProcedure(
    "Could not read the workspace's memory again on this system.",
  )
    .input(exactInput(memoriesFollowParamsSchema))
    .output(EffectSchema.Void),
  [ACCOUNT_ASK_ACT_KIND.MEMORIES_FORGET]: actProcedure(
    "Could not forget that memory on this system.",
  )
    .input(exactInput(memoryForgetParamsSchema))
    .output(EffectSchema.flip(memoriesAnswerViewSchema)),
  [ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE]: actProcedure(
    "Could not transcribe the recording on this system.",
  )
    .input(exactInput(dictationTranscribeParamsSchema))
    .output(EffectSchema.flip(dictationTranscribeAnswerViewSchema)),
};
