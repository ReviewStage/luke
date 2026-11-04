import type {
  ChatGptSignInAnswerView,
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

/**
 * account-ask-procedures.ts -- the account's own asks of the host from Settings and a dictating box.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings or records a clip, so every one refuses the takeover and any
 * other window, in its own sentence. A save's key and a dictated
 * clip each pass through to the host once and are noted nowhere, and what
 * the service answers comes back as the panel's own answer, or why there is
 * none. The account's provider keys, and each workspace's memories, are held
 * at the host while a panel holds their stream open, and reach every panel on
 * app state; how many streams stand open is all that is held here.
 */
export interface AccountAskProceduresDependencies {
  host: {
    /** The account's provider keys held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    providerKeysFollow(): Effect.Effect<void>;
    providerKeysUnfollow(): Effect.Effect<void>;
    /** The account's held provider keys asked again at once, as Try again asks; done once the ask has landed. */
    providerKeysRetry(): Effect.Effect<void>;
    providerKeySave(params: ProviderKeySaveParams): Effect.Effect<ProviderKeysAnswerView>;
    providerKeyRemove(params: ProviderKeyRemoveParams): Effect.Effect<ProviderKeysAnswerView>;
    providerKeyForAgents(params: ProviderKeyForAgentsParams): Effect.Effect<ProviderKeysAnswerView>;
    chatGptSignIn(): Effect.Effect<ChatGptSignInAnswerView>;
    chatGptSignInCancel(): Effect.Effect<void>;
    githubTokenRead(): Effect.Effect<GitHubTokenAnswerView>;
    githubTokenSave(params: GitHubTokenSaveParams): Effect.Effect<GitHubTokenAnswerView>;
    githubTokenRemove(): Effect.Effect<GitHubTokenAnswerView>;
    /** A workspace's memories held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    memoriesFollow(params: MemoriesFollowParams): Effect.Effect<void>;
    memoriesUnfollow(params: MemoriesFollowParams): Effect.Effect<void>;
    /** A workspace's held memories asked again at once, as Try again asks; done once the ask has landed. */
    memoriesRetry(params: MemoriesFollowParams): Effect.Effect<void>;
    memoryForget(params: MemoryForgetParams): Effect.Effect<MemoriesAnswerView>;
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
  /** The account's keys while a window holds a stream open of them, so the host lets them go only with the last. */
  const openKeys: OpenFollows<never> = MutableHashMap.empty();
  /** Each workspace's memories while a window holds a stream open of them, by the workspace. */
  const openMemories: OpenFollows<never> = MutableHashMap.empty();
  return {
    [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW]: actPort[
      ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that nothing is heard down the hold, since the held keys reach the panel on app state.
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
    [ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN]: actPort[ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN].effect(
      function* ({ context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.chatGptSignIn();
      },
    ),
    [ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN_CANCEL]: actPort[
      ACCOUNT_ASK_ACT_KIND.CHATGPT_SIGN_IN_CANCEL
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.chatGptSignInCancel();
    }),
    [ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_READ]: actPort[
      ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_READ
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.githubTokenRead();
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
        // Note that nothing is heard down the hold, since the held memories reach the panel on app state.
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
