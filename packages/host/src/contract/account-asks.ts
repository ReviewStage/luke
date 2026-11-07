import { eventIterator, type } from "@orpc/contract";
import {
  AGENT_CALL_FAILURE,
  chatGptDeviceLoginParamsSchema,
  chatGptDevicePollAnswerViewSchema,
  chatGptDeviceStartAnswerViewSchema,
  chatGptDeviceWaitParamsSchema,
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
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { ACCOUNT_ASK_ACT_KIND } from "./kinds.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * account-asks.ts -- the account's own asks of the host from Settings and a dictating box, declared, and the procedures of the holds beside them.
 *
 * Only a panel draws Settings or records a clip, so every ask is the
 * panel's alone. A kind that carries nothing takes `undefined` alone, so a
 * window calls it with no payload and one sent anything is refused. A save's
 * key and a dictated clip each pass through to the host once and are noted
 * nowhere, and a refusal or a defect of the host's is drawn as the
 * coding-agent calls' unanswered failure, as every one was before it was
 * declared. A workspace's memories are a live follow, declared once
 * (`live-follow.ts`); the keys' and the token's holds, and their Try again,
 * stay procedures of their own (`act-port/account-ask-procedures.ts`).
 */

/** What the window draws for an ask the host could not answer. */
const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The account's plain asks, each answered by the agents' composer. */
export const ACCOUNT_ASK_ACTS = declaredActs({
  PROVIDER_KEYS_SAVE: hostAct({
    input: providerKeySaveParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't save your API key on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  PROVIDER_KEYS_REMOVE: hostAct({
    input: providerKeyRemoveParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't remove your API key on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  PROVIDER_KEYS_FOR_AGENTS: hostAct({
    input: providerKeyForAgentsParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't change your plan's default on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  CHATGPT_DEVICE_START: hostAct({
    input: EffectSchema.Undefined,
    output: chatGptDeviceStartAnswerViewSchema,
    refusal: "Couldn't start connecting Codex on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  CHATGPT_DEVICE_WAIT: hostAct({
    input: chatGptDeviceWaitParamsSchema,
    output: chatGptDevicePollAnswerViewSchema,
    refusal: "Couldn't wait for Codex on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  CHATGPT_DEVICE_CANCEL: hostAct({
    input: chatGptDeviceLoginParamsSchema,
    output: chatGptDevicePollAnswerViewSchema,
    refusal: "Couldn't stop connecting Codex on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  GITHUB_TOKEN_SAVE: hostAct({
    input: githubTokenSaveParamsSchema,
    output: githubTokenAnswerViewSchema,
    refusal: "Could not save your GitHub token on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  GITHUB_TOKEN_REMOVE: hostAct({
    input: EffectSchema.Undefined,
    output: githubTokenAnswerViewSchema,
    refusal: "Could not remove your GitHub token on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  MEMORIES_FORGET: hostAct({
    input: memoryForgetParamsSchema,
    output: memoriesAnswerViewSchema,
    refusal: "Could not forget that memory on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  DICTATION_TRANSCRIBE: hostAct({
    input: dictationTranscribeParamsSchema,
    output: dictationTranscribeAnswerViewSchema,
    refusal: "Could not transcribe the recording on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
});

/** A workspace's memories, followed for Settings › Memory while it holds them. */
export const ACCOUNT_ASK_FOLLOWS = liveFollows({
  MEMORIES_FOLLOW: liveFollow({
    slice: LIVE_READ.MEMORIES,
    hold: HOLD.WINDOW,
    key: memoriesFollowParamsSchema,
    refusal: "Could not follow the workspace's memory on this system.",
    panelOnly: true,
    retry: {
      name: "MEMORIES_RETRY",
      refusal: "Could not read the workspace's memory again on this system.",
    },
  }),
});

export const accountAskActsContract = {
  ...contractOf(ACCOUNT_ASK_ACTS),
  ...followsContractOf(ACCOUNT_ASK_FOLLOWS),
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
};
