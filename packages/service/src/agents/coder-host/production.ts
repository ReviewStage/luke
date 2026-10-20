import { recordTurnFastRefused } from "@luke/database/models/coding-agent-store";
import { spendHostedMeter } from "@luke/database/models/quota";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { failureKind } from "@luke/runtime/effect";
import type { LanguageModel } from "ai";
import { Effect, type Redacted } from "effect";
import { auth } from "../../auth/auth.js";
import { oauthUserInfoFromAuthAnswer, type UserInfoEndpoint } from "../../auth/bearer.js";
import { unparsedWire, type WireBoundaryInput } from "../../core.js";
import { HostedEnvironment } from "../../environment.js";
import type { WebStoreRun } from "../../run.js";
import { accountMeter } from "../agent-runtime/meter.js";
import { conversationReachableBy, runtimeSessionReachableBy } from "../brain-host/conversation.js";
import type { SessionOwnership } from "../brain-host/door.js";
import { deploymentEveOrigin } from "../brain-host/eve-origin.js";
import { MeterUnavailable, type ResearchAccess, researchOpenAiOf } from "../public-research.js";
import { accountProviderKeys } from "./account-keys.js";
import { CODER_ENVIRONMENT, CODER_MODEL_FIXTURE } from "./bounds.js";
import { type LukeKeys, type ProviderKeys, titleModel } from "./model.js";
import { productionSummaryModel, type SummaryModelOf } from "./replay-summary.js";
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
  /** Who reaches a session or a conversation, for the door. */
  readonly ownership: SessionOwnership;
  /** The secret the deployment acts for an account under at eve's door (`EVE_DEPLOYMENT_SECRET`, never the cron's), sealed; nothing while the environment names none. */
  readonly deploymentSecret: () => Redacted.Redacted | undefined;
  /** The origin eve answers on for a message one agent sends another, which no request carries; nothing on a machine neither configured nor deployed. */
  readonly eveOrigin: () => string | undefined;
  /** The keys the account's step runs on: its own where it saved one, Luke's where it did not, each absent where neither stands. */
  readonly keys: (userId: string) => TaskStoreEffect<ProviderKeys>;
  /** Marks the account's turn as one a step of ran at standard speed because Anthropic refused it Fast; a mark that cannot be written is logged, never thrown. */
  readonly fastRefused: (userId: string, turnId: string) => Promise<void>;
  /** The model one account's agent's title is generated on, behind that account's meter; nothing leaves every agent untitled. */
  readonly titleModel: (userId: string) => LanguageModel | undefined;
  /** What one account's public search runs on and counts against: Luke's OpenAI access, nothing while the deployment holds no key, and the account's meter. */
  readonly research: (userId: string) => ResearchAccess;
  /** Whether the deployment asked for the scripted fixture model in place of the providers. */
  readonly scriptedModel: () => boolean;
  /** How an agent this one starts from another summarizes the steps its replay cannot keep, as the Start route's does; none leaves them out. */
  readonly summaryModel?: SummaryModelOf;
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
    // Every inference on Luke's key is counted on the account's meter, a coding agent's as the brain's is.
    const spend = (userId: string) =>
      run(Effect.asVoid(spendHostedMeter({ userId, now: Date.now() })));
    const meter = (userId: string) => accountMeter(spend, userId);
    return {
      writer: () => writer,
      ownership: {
        reachesSession: (userId, sessionId) => run(runtimeSessionReachableBy(userId, sessionId)),
        reachesConversation: (userId, conversationId) =>
          run(conversationReachableBy(userId, conversationId)),
      },
      deploymentSecret: () => environment.eveDeploymentSecret,
      eveOrigin: deploymentEveOrigin,
      userInfo: (input) =>
        Effect.tryPromise(async () => {
          // SAFETY: the auth service answers JSON; the read below is what holds it to the userinfo shape.
          const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
          return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
        }),
      keys: (userId) =>
        accountProviderKeys(userId, {
          luke,
          meter,
          ring: environment.providerKeyEncryptionKeys,
          run,
        }),
      fastRefused: (userId, turnId) =>
        run(recordTurnFastRefused(userId, turnId)).catch((cause: unknown) => {
          // Note that the failure is reported by its kind, because a store's message can quote a row.
          console.warn(`A turn's Fast refusal was not recorded: ${failureKind(cause)}`);
        }),
      titleModel: (userId) => titleModel(luke, meter(userId)),
      research: (userId) => ({
        openAi: researchOpenAiOf(environment.openAiKey),
        spend: Effect.tryPromise({
          try: () => spend(userId),
          catch: (cause) => new MeterUnavailable({ cause }),
        }),
      }),
      scriptedModel: () =>
        process.env[CODER_ENVIRONMENT.MODEL_FIXTURE] === CODER_MODEL_FIXTURE.SCRIPTED,
      summaryModel: (owner, chosen, effort) =>
        productionSummaryModel(owner, chosen, effort).pipe(
          Effect.provideService(HostedEnvironment, environment),
        ),
      now: () => Date.now(),
    };
  },
);
