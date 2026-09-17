import {
  failedHousekeeping,
  type MemoryHousekeepingResult,
  skippedHousekeeping,
} from "@sidecar/memory";
import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import type { ToolHostUnavailable } from "@sidecar/runtime/vocabulary";
import type { LanguageModel } from "ai";
import { Cache, Data, Duration, Effect, Exit, Result, type Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import type { MemoryCompactionRequestedContext } from "eve/memory";
import type { ToolContext as EveToolContext } from "eve/tools";
import {
  ACTION_RESULT_STATUS,
  BRAIN_TURN_TRIGGER,
  type BrainTurnTrigger,
  type CloudAgentProviderId,
  isRecord,
  isWireString,
  type SessionProviderPlugin,
  type UnparsedWireValue,
  type WireRecord,
} from "../../core.js";
import { CATALOG_TOOL_SET } from "../brain-tool-set.js";
import { cloudSessionPluginFor } from "../cloud-adapters.js";
import { askRecord } from "../store/asks.js";
import { toolSetHashOf } from "../store/content-addressed.js";
import {
  type ConversationTarget,
  promptHashOf,
  quietUntilByAccount,
  type StoreWriter,
} from "../store/index.js";
import { toolHostSeam } from "../store-failure.js";
import { offerBriefing } from "./announce.js";
import { turnKindOf } from "./auth.js";
import {
  BRAIN_HOST,
  BRAIN_HOST_MODEL_FIXTURE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN_KIND,
  type BrainHostTurn,
} from "./bounds.js";
import { deliverChildCompletion } from "./child-completion.js";
import { hostedChildAccess } from "./children.js";
import { hostedStandingContext, readRecentMessages } from "./context.js";
import {
  type AdmittedConversation,
  admitConversation,
  type ConversationAdmission,
  claimRuntimeSession,
  SESSION_STANDING,
} from "./conversation.js";
import { readWorkspaceDefaults } from "./defaults.js";
import { EVE_CALLER, type EveSessionsComposer, eveSessionsComposer } from "./eve-sessions.js";
import { hostTurnId } from "./ids.js";
import { flushMemory, MEMORY_FLUSH_REFUSAL } from "./memory-flush.js";
import { meteredModel, openAiBrainModel } from "./model.js";
import { hostedNotebookAccess } from "./notebook.js";
import { hostedActionCarrier } from "./performer.js";
import { type BrainHostSeams, onceComposed } from "./production.js";
import { type RelayStateStore, StreamRelay } from "./relay.js";
import {
  brainRosterOf,
  EMPTY_HOSTED_ROSTER,
  type HostedRoster,
  readHostedRoster,
} from "./roster.js";
import { rotationSeedText } from "./seed.js";
import { carryStop } from "./stop-carrier.js";
import {
  type HostedToolDeclaration,
  hostedToolDeclarations,
  hostedTurnPolicy,
  runHostedTool,
} from "./tools.js";
import { hostedTranscriptReads } from "./transcript.js";
import { hostedPrompt, hostedWorkspaceAccess, seedHostedWorkspace } from "./workspace.js";

/**
 * The hosted brain composed over eve and the v2 store: what the eve project's
 * authored files call, one function per thing eve asks the host for. eve is
 * the runtime and the event emitter — the loop, the sessions, the queue, the
 * stream — and the host is everything eve leaves to its author: who a
 * session is for, the prompt its turns run under, the standing context each
 * turn opens with, the tools it is offered and what they reach, the model
 * with the meter in front of it, and the relay from eve's stream into the
 * store's writer, which is the sole consumer and the only thing that writes
 * a message row. Nothing here decides on the user's behalf: every write runs
 * under the conversation the session was admitted for, and every action
 * through the same admission as everywhere else.
 */

/** The turn a resolver or a tool runs in, as eve names it and as the store keys it; plain data, so a tool may capture it. */
interface HostedTurn {
  readonly kind: BrainHostTurn;
  readonly trigger: BrainTurnTrigger;
  readonly turnId: string;
}

/** What a tool eve runs is bound to: the conversation and the turn, as data eve can keep across its steps. */
export interface HostedToolBinding {
  readonly target: ConversationTarget;
  readonly turn: HostedTurn;
}

/** The kind of turn the current request opened, with the trigger the run stream names it by. */
interface HostedTurnKind {
  readonly kind: BrainHostTurn;
  readonly trigger: BrainTurnTrigger;
}

/** The prompt a session runs under and the content address its turns are recorded under. */
interface HostedSessionPrompt {
  readonly text: string;
  readonly hash: string;
}

/**
 * What the eve project keeps of the session's prompt between the start that
 * composed it and the turns that run under it: the content address alone,
 * absent until the session has composed one. It lives in eve's durable
 * session state, because the prompt applies at session scope and the turn
 * row must name the prompt the model actually reads rather than one composed
 * again from rows that may have changed since.
 */
export interface SessionPromptRecord {
  readonly hash?: string;
}

/** The turn id eve's `turn.started` event carries, read off the event a resolver is handed; nothing for any other shape. */
export function eveTurnIdOf(event: UnparsedWireValue): string | undefined {
  if (!isRecord(event) || !isRecord(event.data)) return undefined;
  return isWireString(event.data.turnId) ? event.data.turnId : undefined;
}

/** The roster an account's tools last read, and the sealed key of each provider it was read under. */
interface LastRosterRead {
  readonly roster: HostedRoster;
  readonly sealedKeys: ReadonlyMap<string, string>;
}

/**
 * What one cached plugin is keyed by. The sealed key is the provider's row as
 * the vault held it when the account's roster was last read, so a rotated or
 * removed key names another plugin rather than invalidating this one.
 */
class PluginKey extends Data.Class<{
  readonly userId: string;
  readonly providerId: CloudAgentProviderId;
  readonly sealedKey: string;
}> {}

/** What a host function answers: an effect over the ambient client, which eve's own authored files run at the web's edge. */
type HostEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

export interface BrainHost {
  /** Whether the session stands for a conversation of the caller's and is the one it runs in; every other function takes what this admitted. */
  admit(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The same admission for a session claiming the conversation as it starts, before its record stands. */
  admitStarting(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The kind of turn the current request opened, or nothing for a request that named none. */
  turnKindOf(auth: SessionAuth): HostedTurnKind | undefined;
  /** The turn eve just started, keyed as the store keys it; nothing for a request that named no kind. */
  turnOf(auth: SessionAuth, sessionId: string, eveTurnId: string): HostedTurn | undefined;
  /** The prompt a session runs under, composed from the workspace rows under the hosted policy, with the hash its turns are recorded under; the text itself is stored nowhere. */
  prompt(
    admitted: AdmittedConversation,
    trigger: BrainTurnTrigger,
  ): HostEffect<HostedSessionPrompt>;
  /** The standing context one turn opens with: the roster and the projects, as data. */
  standingContext(admitted: AdmittedConversation): HostEffect<string>;
  /** The conversation so far, for a session opened over a conversation with words already said; nothing otherwise. */
  seed(admitted: AdmittedConversation): HostEffect<string | undefined>;
  /** The tools one turn is offered, as declarations, read against the account's quiet as the turn starts; the eve project binds each to `runTool`. */
  toolDeclarations(
    target: ConversationTarget,
    turn: HostedTurn,
  ): HostEffect<readonly HostedToolDeclaration[]>;
  /** Carries one call of one declared tool under the binding the tool captured and the standing eve hands it; over the edge's `HttpClient` too, for the one embeddings call a notebook search makes. */
  runTool(
    name: string,
    binding: HostedToolBinding,
    input: UnparsedWireValue,
    context: EveToolContext,
  ): Effect.Effect<
    WireRecord,
    SqlError | Schema.SchemaError,
    SqlClient.SqlClient | HttpClient.HttpClient
  >;
  /** The model one inference runs on, the meter spent for the account first; nothing when the deployment holds no key. */
  model(admitted: AdmittedConversation): LanguageModel | undefined;
  /**
   * The pre-compaction memory flush, run from eve's own `compaction.requested`
   * capture: one housekeeping turn over the copy of the history eve hands in,
   * for a session admitted for a conversation of the caller's and running a
   * developer's own ask, at most once per compaction cycle, on the account's
   * metered model or the fixture the eve project hands in its place. Total:
   * every way it can end is an outcome, never an error eve would see, so the
   * developer's turn folds and proceeds whatever became of the flush.
   */
  flush(
    capture: MemoryCompactionRequestedContext,
    fixtureModel?: LanguageModel,
  ): Effect.Effect<MemoryHousekeepingResult, never, SqlClient.SqlClient>;
  /** Claims the conversation for the eve session now starting; answers whether the record is now this session's. */
  sessionStarted(admitted: AdmittedConversation, sessionId: string): HostEffect<boolean>;
  /** Relays one event of the session's stream into the store, under the state the caller keeps for the session and the prompt it composed; over the edge's `HttpClient` too, for the Stop and the child completion the relay carries to eve. */
  relay(
    event: MessageStreamEvent,
    admitted: AdmittedConversation,
    session: SessionContext["session"],
    state: RelayStateStore,
    prompt: SessionPromptRecord,
  ): Effect.Effect<
    void,
    SqlError | Schema.SchemaError,
    SqlClient.SqlClient | HttpClient.HttpClient
  >;
}

export function brainHost(seams: BrainHostSeams): BrainHost {
  /**
   * The relay as eve's own stream handler: it holds no state of its own, so
   * one stands per event rather than one per host, and every seam it reaches
   * is the store's own effect on the fiber the event arrived on. eve's client
   * is composed from the constructor the event's fiber read off the edge's
   * `HttpClient`, once per event, the way `runTool` hands the same client on.
   */
  const relayOver = (writer: StoreWriter, eve: EveSessionsComposer) =>
    new StreamRelay({
      writer,
      asks: askRecord(),
      // A Stop an ask took while it waited is carried the moment its turn starts, by the deployment
      // acting for the account, since the hook that sees the start holds no bearer of the account's;
      // a deployment with no secret or no origin for eve reports the Stop it could not carry.
      stopTurn: (target, sessionId, eveTurnId, turnId) =>
        Effect.suspend(() => {
          const secret = seams.deploymentSecret();
          const origin = seams.eveOrigin();
          if (secret === undefined || origin === undefined) {
            return Effect.logWarning(
              `The Stop on turn ${eveTurnId} of session ${sessionId} could not be carried.`,
            );
          }
          return carryStop(
            {
              eve: eve({
                origin,
                caller: { kind: EVE_CALLER.DEPLOYMENT, secret, account: target.userId },
              }),
              writer,
              now: seams.now,
              report: (message) => console.warn(message),
            },
            target,
            sessionId,
            eveTurnId,
            turnId,
          );
        }),
      offer: (target, turnId) => offerBriefing({ writer, now: seams.now }, target, turnId),
      // A child's completion reaches its parent as the deployment acting for the account, on the
      // same terms as the Stop above; the delivery reads the secret and the origin itself, and a
      // deployment holding neither claims nothing, so the sweep visits the child once it has both.
      deliverCompletion: (child) =>
        Effect.asVoid(
          deliverChildCompletion(
            {
              deploymentSecret: seams.deploymentSecret,
              eveOrigin: seams.eveOrigin,
              eve,
              tools: CATALOG_TOOL_SET,
              now: seams.now,
              report: (message) => console.warn(message),
            },
            child,
          ),
        ),
      now: seams.now,
      report: (message) => console.warn(message),
    });

  /**
   * The roster each account's tools last read, with the sealed key of each
   * provider it was read under, kept for the process's life: a plugin keeps
   * where in each chat its last transcript read reached, so a read_transcript
   * of a long chat costs one request from that end rather than a walk from
   * its start, and a plugin rebuilt for every call would forget it.
   */
  const rosters = new Map<string, LastRosterRead>();
  /**
   * The plugins built for the accounts, bounded and keyed by the sealed key
   * each was built under: a rotated or removed key is another key here, so the
   * plugin bound to the old one is never reached again and ages out. Built on
   * the first fiber that asks, since the host itself is constructed outside
   * any effect.
   */
  const plugins = onceComposed(
    Cache.makeWith(
      (key: PluginKey) =>
        Effect.gen(function* () {
          const client = yield* SqlClient.SqlClient;
          // The key is read as the plugin is built: the plugin interface reads
          // its key through an `Effect<string | undefined, never>` and takes a
          // read that fails for a key that is absent, so a vault row the
          // service cannot read fails the call that asked, leaves the plugin
          // unbuilt, and is never told to the model as a missing key.
          const apiKey = yield* toolHostSeam(client, seams.providerKey(key.userId, key.providerId));
          return cloudSessionPluginFor(key.providerId, {
            readApiKey: () => Effect.succeed(apiKey),
            reported: () =>
              (rosters.get(key.userId)?.roster ?? EMPTY_HOSTED_ROSTER).observations.get(
                key.providerId,
              ) ?? [],
          });
        }),
      {
        capacity: BRAIN_HOST.PLUGIN_CACHE_CAPACITY,
        requireServicesAt: "lookup",
        // A plugin stands for as long as its sealed key does; a lookup the
        // store refused is not kept, so the next call reads the key again.
        timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
      },
    ),
  );
  /**
   * The plugins an account's tools reach, built over the request's own client
   * and under the account's key as the vault holds it now; a changed vault is
   * another key here, so the plugin a call reaches holds the current one.
   */
  const pluginFor =
    (userId: string, client: SqlClient.SqlClient) =>
    (providerId: CloudAgentProviderId): Effect.Effect<SessionProviderPlugin, ToolHostUnavailable> =>
      Effect.provideService(
        Effect.flatMap(plugins(), (cache) =>
          Cache.get(
            cache,
            new PluginKey({
              userId,
              providerId,
              sealedKey: rosters.get(userId)?.sealedKeys.get(providerId) ?? "",
            }),
          ),
        ),
        SqlClient.SqlClient,
        client,
      );
  const rosterOf = (userId: string): HostEffect<HostedRoster> =>
    Effect.gen(function* () {
      const rows = yield* seams.vaultRows(userId);
      const roster = yield* readHostedRoster(seams.store(), userId, rows, seams.vaultSecret());
      rosters.set(userId, {
        roster,
        sealedKeys: new Map(rows.map((row) => [row.providerId, row.ciphertext])),
      });
      return roster;
    });

  /** The account's metered model, or nothing while the deployment holds no key. */
  const modelFor = (admitted: AdmittedConversation): LanguageModel | undefined => {
    const access = seams.openAi();
    if (!access) return undefined;
    return meteredModel(openAiBrainModel(access.apiKey, access.modelId), () =>
      seams.spend(admitted.target.userId),
    );
  };

  /**
   * The declarations one turn is offered, read against the account's quiet
   * as the turn starts. The tools resolver and the relay's tool-set hash both
   * read here, so the hash names what the model was offered and not a list
   * kept beside it. The quiet is the same query the push pass and the
   * briefing look read, so the three decide on one standing.
   */
  const declarationsFor = (
    target: ConversationTarget,
    trigger: BrainTurnTrigger,
  ): HostEffect<readonly HostedToolDeclaration[]> =>
    Effect.map(quietUntilByAccount(seams.now(), [target.userId]), (quiet) =>
      hostedToolDeclarations(trigger, { quiet: quiet.has(target.userId) }),
    );

  return {
    admit: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CURRENT }),
    admitStarting: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CLAIMING }),

    turnKindOf(auth) {
      const kind = turnKindOf(auth.current);
      return kind === undefined ? undefined : { kind, trigger: BRAIN_HOST_TURN_KIND[kind].trigger };
    },

    turnOf(auth, sessionId, eveTurnId) {
      const kind = turnKindOf(auth.current);
      if (kind === undefined) return undefined;
      return {
        kind,
        trigger: BRAIN_HOST_TURN_KIND[kind].trigger,
        turnId: hostTurnId(sessionId, eveTurnId),
      };
    },

    prompt: (admitted, trigger) =>
      Effect.gen(function* () {
        const store = seams.store();
        yield* seedHostedWorkspace(store, admitted.target.userId, seams.now());
        const modelId = seams.openAi()?.modelId;
        const built = yield* hostedPrompt(store, admitted.target.userId, {
          policy: hostedTurnPolicy(trigger),
          ...(modelId !== undefined ? { model: modelId } : undefined),
        });
        return { text: built.text, hash: promptHashOf(built.text) };
      }),

    standingContext: (admitted) =>
      Effect.gen(function* () {
        const { userId } = admitted.target;
        const now = seams.now();
        const roster = yield* rosterOf(userId);
        const defaults = yield* readWorkspaceDefaults(userId);
        return hostedStandingContext({
          roster,
          rosterText: brainRosterOf(roster, now).text,
          defaults,
          now,
        });
      }),

    seed: (admitted) =>
      Effect.map(
        readRecentMessages(admitted.target, CATALOG_TOOL_SET, BRAIN_HOST.SEED_MESSAGES),
        (recent) => rotationSeedText(recent, seams.now()),
      ),

    toolDeclarations: (target, turn) => declarationsFor(target, turn.trigger),

    runTool: (name, binding, input, context) =>
      Effect.gen(function* () {
        // Admitted again as the call runs, not only as the tools were resolved:
        // a conversation that rotated to a newer session mid-turn refuses the
        // old session's calls here, so no effect lands without a turn record.
        const standing = yield* admitConversation(context.session.auth, {
          id: context.session.id,
          standing: SESSION_STANDING.CURRENT,
        });
        if (Result.isFailure(standing)) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: standing.failure };
        }
        const client = yield* SqlClient.SqlClient;
        const http = yield* HttpClient.HttpClient;
        const writer = yield* seams.writer();
        const { userId } = binding.target;
        // Every seam below reads over the request's own client, and a row the
        // service cannot read fails the seam as the tool contract's own
        // unavailability, logged where its cause is known; the tool run
        // answers such a call as rejected, so the model is told the call did
        // not run and nothing of why.
        const roster = () => toolHostSeam(client, rosterOf(userId));
        const transcripts = hostedTranscriptReads({
          client,
          userId,
          roster,
          pluginFor: pluginFor(userId, client),
          now: seams.now,
        });
        const carrier = hostedActionCarrier({
          roster,
          defaults: () => toolHostSeam(client, readWorkspaceDefaults(userId)),
          apiKey: (providerId) => toolHostSeam(client, seams.providerKey(userId, providerId)),
          execute: seams.executeAction,
        });
        return yield* runHostedTool(
          name,
          input,
          context,
          {
            conversation: binding.target,
            roster,
            carrier,
            transcripts,
            workspace: hostedWorkspaceAccess(client, seams.store(), userId, seams.now),
            notebook: hostedNotebookAccess({
              client,
              http,
              store: seams.store(),
              userId,
              embedder: seams.embedder(),
              now: seams.now,
            }),
            // A child is opened, and its turn cancelled, by the deployment acting for the account,
            // the way the scheduled opener acts for it; a deployment with no secret or no origin for
            // eve opens none and cancels none.
            children: hostedChildAccess(client, {
              conversation: binding.target,
              kind: standing.success.kind,
              turnId: binding.turn.turnId,
              opener: {
                deploymentSecret: seams.deploymentSecret,
                eveOrigin: seams.eveOrigin,
                eve: yield* eveSessionsComposer,
                now: seams.now,
                report: (message) => console.warn(message),
              },
              writer,
              now: seams.now,
            }),
            now: seams.now,
          },
          {
            trigger: binding.turn.trigger,
            turnId: binding.turn.turnId,
            runId: binding.turn.turnId,
          },
        );
      }),

    model: (admitted) => modelFor(admitted),

    flush: (capture, fixtureModel) =>
      Effect.gen(function* () {
        const admitted = yield* admitConversation(capture.session.auth, {
          id: capture.session.id,
          standing: SESSION_STANDING.CURRENT,
        });
        if (Result.isFailure(admitted)) return skippedHousekeeping(admitted.failure);
        // OpenClaw's session-kind gate: a scaffolding turn — the roster's
        // observation, a child's task — produces no durable memory, so only
        // a turn the developer opened flushes, typed or spoken.
        const turn = turnKindOf(capture.session.auth.current);
        if (turn === undefined || BRAIN_HOST_TURN_KIND[turn].trigger !== BRAIN_TURN_TRIGGER.ASK) {
          return skippedHousekeeping(MEMORY_FLUSH_REFUSAL.NOT_AN_ASK);
        }
        const model = fixtureModel ?? modelFor(admitted.success);
        if (!model) return skippedHousekeeping(BRAIN_HOST_REFUSAL.NO_MODEL);
        const client = yield* SqlClient.SqlClient;
        const { target } = admitted.success;
        const { userId } = target;
        return yield* flushMemory({
          target,
          operationId: capture.operationId,
          messages: capture.messages,
          signal: capture.abortSignal,
          model,
          workspace: hostedWorkspaceAccess(client, seams.store(), userId, seams.now),
          now: seams.now,
        });
      }).pipe((flush) =>
        // A flush the caller cancelled did not fail: an interruption passes
        // through rather than standing as a durable refusal reason.
        catchAllButInterrupt(flush, (cause) =>
          Effect.as(
            Effect.logWarning("The memory flush could not run", cause),
            failedHousekeeping(MEMORY_FLUSH_REFUSAL.HOST_FAILED),
          ),
        ),
      ),

    sessionStarted: (admitted, sessionId) =>
      claimRuntimeSession(admitted.target, sessionId, new Date(seams.now())),

    relay: (event, admitted, session, state, prompt) =>
      Effect.gen(function* () {
        const model = seams.scriptedModel()
          ? BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID
          : seams.openAi()?.modelId;
        const turn = turnKindOf(session.auth.current);
        // The tool set's hash is taken as each turn starts, from the same
        // declarations the tools resolver hands eve for the same kind of turn,
        // so the hash names what the model is offered and not a list kept
        // beside it.
        const toolSetHash =
          event.type === "turn.started" && turn !== undefined
            ? toolSetHashOf(
                yield* declarationsFor(admitted.target, BRAIN_HOST_TURN_KIND[turn].trigger),
              )
            : undefined;
        const writer = yield* seams.writer();
        yield* relayOver(writer, yield* eveSessionsComposer).handle(event, {
          sessionId: session.id,
          target: admitted.target,
          kind: admitted.kind,
          turn,
          ...(model !== undefined ? { model } : undefined),
          ...(prompt.hash !== undefined ? { promptHash: prompt.hash } : undefined),
          ...(toolSetHash !== undefined ? { toolSetHash } : undefined),
          state,
        });
      }),
  };
}
