import type {
  ChatGptDeviceLoginParams,
  ChatGptDevicePollAnswerView,
  ChatGptDeviceStartAnswerView,
  ChatGptDeviceWaitParams,
  DictationTranscribeAnswerView,
  DictationTranscribeParams,
  GitHubTokenAnswerView,
  GitHubTokenSaveParams,
  MemoriesAnswerView,
  MemoriesFollowParams,
  MemoryForgetParams,
  ProviderKeyForAgentsParams,
  ProviderKeyRemoveParams,
  ProviderKeySaveParams,
  ProviderKeysAnswerView,
} from "@repo/features/agent-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { ACCOUNT_ASK_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface AccountAskProceduresDependencies {
  host: {
    providerKeysFollow(): Effect.Effect<void>;
    providerKeysUnfollow(): Effect.Effect<void>;
    providerKeysRetry(): Effect.Effect<void>;
    providerKeySave(params: ProviderKeySaveParams): Effect.Effect<ProviderKeysAnswerView>;
    providerKeyRemove(params: ProviderKeyRemoveParams): Effect.Effect<ProviderKeysAnswerView>;
    providerKeyForAgents(params: ProviderKeyForAgentsParams): Effect.Effect<ProviderKeysAnswerView>;
    chatGptDeviceStart(): Effect.Effect<ChatGptDeviceStartAnswerView>;
    chatGptDeviceWait(params: ChatGptDeviceWaitParams): Effect.Effect<ChatGptDevicePollAnswerView>;
    chatGptDeviceCancel(
      params: ChatGptDeviceLoginParams,
    ): Effect.Effect<ChatGptDevicePollAnswerView>;
    githubTokenFollow(): Effect.Effect<void>;
    githubTokenUnfollow(): Effect.Effect<void>;
    githubTokenRetry(): Effect.Effect<void>;
    githubTokenSave(params: GitHubTokenSaveParams): Effect.Effect<GitHubTokenAnswerView>;
    githubTokenRemove(): Effect.Effect<GitHubTokenAnswerView>;
    memoriesFollow(params: MemoriesFollowParams): Effect.Effect<void>;
    memoriesUnfollow(params: MemoriesFollowParams): Effect.Effect<void>;
    memoriesRetry(params: MemoriesFollowParams): Effect.Effect<void>;
    memoryForget(params: MemoryForgetParams): Effect.Effect<MemoriesAnswerView>;
    dictationTranscribe(
      params: DictationTranscribeParams,
    ): Effect.Effect<DictationTranscribeAnswerView>;
  };
}

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function accountAskProcedures(dependencies: AccountAskProceduresDependencies) {
  const { host } = dependencies;
  const openKeys: OpenFollows<never> = MutableHashMap.empty();
  const openToken: OpenFollows<never> = MutableHashMap.empty();
  const openMemories: OpenFollows<never> = MutableHashMap.empty();
  return {
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: () => "keys",
          follow: () => host.providerKeysFollow(),
          unfollow: () => host.providerKeysUnfollow(),
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openKeys,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_RETRY]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.providerKeysRetry();
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
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOR_AGENTS]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOR_AGENTS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.providerKeyForAgents(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_START]: actPort[
      ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_START
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.chatGptDeviceStart();
    }),
    [ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_WAIT]: actPort[
      ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_WAIT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.chatGptDeviceWait(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_CANCEL]: actPort[
      ACCOUNT_ASK_ACT_KIND.CHATGPT_DEVICE_CANCEL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.chatGptDeviceCancel(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW]: actPort[
      ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: () => "token",
          follow: () => host.githubTokenFollow(),
          unfollow: () => host.githubTokenUnfollow(),
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openToken,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_RETRY]: actPort[
      ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.githubTokenRetry();
    }),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_SAVE]: actPort[
      ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_SAVE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.githubTokenSave(input);
    }),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_REMOVE]: actPort[
      ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_REMOVE
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.githubTokenRemove();
    }),
    [ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW]: actPort[ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (held: MemoriesFollowParams) => held.workspaceId,
            follow: host.memoriesFollow,
            unfollow: host.memoriesUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
          },
          openMemories,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [ACCOUNT_ASK_ACT_KIND.MEMORIES_RETRY]: actPort[ACCOUNT_ASK_ACT_KIND.MEMORIES_RETRY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.memoriesRetry(input);
      },
    ),
    [ACCOUNT_ASK_ACT_KIND.MEMORIES_FORGET]: actPort[ACCOUNT_ASK_ACT_KIND.MEMORIES_FORGET].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.memoryForget(input);
      },
    ),
    [ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE]: actPort[
      ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.dictationTranscribe(input);
    }),
  };
}
