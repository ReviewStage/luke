import type { LanguageModel } from "ai";
import { Effect, type Redacted } from "effect";
import { auth } from "../../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../../core.js";
import type { WebStoreRun } from "../../runtime.js";
import { oauthUserInfoFromAuthAnswer, type UserInfoEndpoint } from "../bearer.js";
import { conversationOwnedBy, runtimeSessionOwner } from "../brain-host/conversation.js";
import type { SessionOwnership } from "../brain-host/door.js";
import { HostedEnvironment } from "../environment.js";
import type { PlanStoreEffect } from "../plan-store.js";
import { type StoreWriter, storeWriter } from "../store/index.js";
import { accountProviderKeys } from "./account-keys.js";
import { CODER_ENVIRONMENT, CODER_MODEL_FIXTURE } from "./bounds.js";
import { type LukeKeys, type ProviderKeys, titleModel } from "./model.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * production.ts -- the deployment's real seams behind the coding-agent service's authored files.
 *
 * Built over `HostedEnvironment` so every key is read once, as the
 * environment is, and travels sealed: the bearer's account through the auth
 * service's own userinfo, the writer over the coding agent's tool set, and
 * the keys a step runs on — the account's own where it saved one, read
 * from its rows for every step, and Luke's own Anthropic and OpenAI keys
 * where it did not. The
 * writer is built on first use and kept for the instance, so the agent's
 * discovery, which imports the authored files, touches no database. An
 * authored file hands what it needs here and nothing else.
 */
export interface CoderHostSeams {
  /** The writer over the coding agent's tool set, composed once per instance. */
  readonly writer: () => Effect.Effect<StoreWriter>;
  readonly userInfo: UserInfoEndpoint;
  /** Who a session or a conversation belongs to, for the door. */
  readonly ownership: SessionOwnership;
  /** The secret the deployment acts for an account under at eve's door, sealed; nothing while the environment names none. */
  readonly deploymentSecret: () => Redacted.Redacted | undefined;
  /** The keys the account's step runs on: its own where it saved one, Luke's where it did not, each absent where neither stands. */
  readonly keys: (userId: string) => PlanStoreEffect<ProviderKeys>;
  /** The model an agent's title is generated on; nothing leaves every agent untitled. */
  readonly titleModel: () => LanguageModel | undefined;
  /** Whether the deployment asked for the scripted fixture model in place of the providers. */
  readonly scriptedModel: () => boolean;
  readonly now: () => number;
}

/**
 * The deployment's seams, built over the runner the edge composing them hands
 * in and the environment service the edge provides. `ownership` answers
 * promises because eve's own door takes a promise-shaped ownership, which has
 * no request fiber to compose into, so the authored eve file that builds these
 * seams hands its own `runWeb` down rather than this module keeping a runner.
 */
export const productionCoderHostSeams = /* @__PURE__ */ Effect.fn("web/productionCoderHostSeams")(
  function* (run: WebStoreRun): Effect.fn.Return<CoderHostSeams, never, HostedEnvironment> {
    const environment = yield* HostedEnvironment;
    const writer = yield* Effect.cached(storeWriter({ tools: CODER_TOOL_SET }));
    const luke: LukeKeys = {
      anthropic: environment.anthropicKey,
      openAi: environment.openAiKey,
    };
    return {
      writer: () => writer,
      ownership: {
        sessionOwner: (sessionId) => run(runtimeSessionOwner(sessionId)),
        ownsConversation: (userId, conversationId) =>
          run(conversationOwnedBy(userId, conversationId)),
      },
      deploymentSecret: () => environment.cronSecret,
      userInfo: (input) =>
        Effect.tryPromise(async () => {
          // SAFETY: the auth service answers JSON; the read below is what holds it to the userinfo shape.
          const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
          return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
        }),
      keys: (userId) =>
        accountProviderKeys(userId, { luke, ring: environment.providerKeyEncryptionKeys, run }),
      titleModel: () => titleModel(luke),
      scriptedModel: () =>
        process.env[CODER_ENVIRONMENT.MODEL_FIXTURE] === CODER_MODEL_FIXTURE.SCRIPTED,
      now: () => Date.now(),
    };
  },
);
