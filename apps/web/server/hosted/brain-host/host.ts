import type { LanguageModel } from "ai";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import {
  ACTION_RESULT_STATUS,
  type BrainTurnTrigger,
  type CloudAgentProviderId,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "../../core.js";
import { CATALOG_TOOL_SET } from "../brain-tool-set.js";
import { cloudSessionPluginFor } from "../cloud-adapters.js";
import type { ConversationTarget } from "../store/index.js";
import { offerBriefing } from "./announce.js";
import { turnKindOf } from "./auth.js";
import {
  BRAIN_HOST,
  BRAIN_HOST_MODEL_FIXTURE,
  BRAIN_HOST_TURN_KIND,
  type BrainHostTurn,
} from "./bounds.js";
import { hostedStandingContext, readRecentMessages } from "./context.js";
import {
  type AdmittedConversation,
  admitConversation,
  type ConversationAdmission,
  claimRuntimeSession,
  SESSION_STANDING,
} from "./conversation.js";
import { readWorkspaceDefaults } from "./defaults.js";
import { hostTurnId } from "./ids.js";
import { meteredModel, openAiBrainModel } from "./model.js";
import { hostedActionCarrier, hostedFactsWriter } from "./performer.js";
import type { BrainHostSeams } from "./production.js";
import { type RelayStateStore, StreamRelay } from "./relay.js";
import {
  brainRosterOf,
  EMPTY_HOSTED_ROSTER,
  type HostedRoster,
  readHostedRoster,
} from "./roster.js";
import { rotationSeedText } from "./seed.js";
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

/** The turn id eve's `turn.started` event carries, read off the event a resolver is handed; nothing for any other shape. */
export function eveTurnIdOf(event: UnparsedWireValue): string | undefined {
  if (!isRecord(event) || !isRecord(event.data)) return undefined;
  return isWireString(event.data.turnId) ? event.data.turnId : undefined;
}

export interface BrainHost {
  /** Whether the session stands for a conversation of the caller's and is the one it runs in; every other function takes what this admitted. */
  admit(auth: SessionAuth, sessionId: string): Promise<ConversationAdmission>;
  /** The same admission for a session claiming the conversation as it starts, before its record stands. */
  admitStarting(auth: SessionAuth, sessionId: string): Promise<ConversationAdmission>;
  /** The kind of turn the current request opened, or nothing for a request that named none. */
  turnKindOf(auth: SessionAuth): HostedTurnKind | undefined;
  /** The turn eve just started, keyed as the store keys it; nothing for a request that named no kind. */
  turnOf(auth: SessionAuth, sessionId: string, eveTurnId: string): HostedTurn | undefined;
  /** The prompt a session runs under, composed from the workspace rows under the hosted policy. */
  prompt(admitted: AdmittedConversation, trigger: BrainTurnTrigger): Promise<string>;
  /** The standing context one turn opens with: roster, projects, facts, and the recent exchange, as data. */
  standingContext(admitted: AdmittedConversation): Promise<string>;
  /** The conversation so far, for a session opened over a conversation with words already said; nothing otherwise. */
  seed(admitted: AdmittedConversation): Promise<string | undefined>;
  /** The tools one turn is offered, as declarations; the eve project binds each to `runTool`. */
  toolDeclarations(turn: HostedTurn): readonly HostedToolDeclaration[];
  /** Carries one call of one declared tool under the binding the tool captured and the standing eve hands it. */
  runTool(
    name: string,
    binding: HostedToolBinding,
    input: UnparsedWireValue,
    context: EveToolContext,
  ): Promise<WireRecord>;
  /** The model one inference runs on, the meter spent for the account first; nothing when the deployment holds no key. */
  model(admitted: AdmittedConversation): LanguageModel | undefined;
  /** Claims the conversation for the eve session now starting; answers whether the record is now this session's. */
  sessionStarted(admitted: AdmittedConversation, sessionId: string): Promise<boolean>;
  /** Relays one event of the session's stream into the store, under the state the caller keeps for the session. */
  relay(
    event: MessageStreamEvent,
    admitted: AdmittedConversation,
    session: SessionContext["session"],
    state: RelayStateStore,
  ): Promise<void>;
}

export function brainHost(seams: BrainHostSeams): BrainHost {
  const relay = new StreamRelay({
    writer: {
      consume: async (target, event) => (await seams.writer()).consume(target, event),
      enqueueTurn: async (target, enqueue) => (await seams.writer()).enqueueTurn(target, enqueue),
    },
    offer: async (target, turnId) =>
      offerBriefing(
        { run: seams.run, writer: await seams.writer(), now: seams.now },
        target,
        turnId,
      ),
    now: seams.now,
    report: (message) => console.warn(message),
  });

  /**
   * The roster each account's tools last read, and the cloud plugins built
   * over it, kept for the process's life: a plugin keeps where in each chat
   * its last transcript read reached, so a read_transcript of a long chat
   * costs one request from that end rather than a walk from its start, and
   * a plugin rebuilt for every call would forget it.
   */
  const rosters = new Map<string, HostedRoster>();
  /** The plugins built for an account, under the vault they were built over; a changed vault rebuilds them. */
  const plugins = new Map<
    string,
    {
      vault: string;
      byProvider: Map<CloudAgentProviderId, ReturnType<typeof cloudSessionPluginFor>>;
    }
  >();
  const vaults = new Map<string, string>();
  const pluginFor = (userId: string) => (providerId: CloudAgentProviderId) => {
    const vault = vaults.get(userId) ?? "";
    let held = plugins.get(userId);
    if (held === undefined || held.vault !== vault) {
      held = { vault, byProvider: new Map() };
      plugins.set(userId, held);
    }
    const standing = held.byProvider.get(providerId);
    if (standing) return standing;
    const plugin = cloudSessionPluginFor(providerId, {
      readApiKey: () => seams.providerKey(userId, providerId),
      reported: () =>
        (rosters.get(userId) ?? EMPTY_HOSTED_ROSTER).observations.get(providerId) ?? [],
    });
    held.byProvider.set(providerId, plugin);
    return plugin;
  };
  const rosterOf = async (userId: string) => {
    const rows = await seams.vaultRows(userId);
    // The vault as it stands, by its sealed rows: a rotated or removed key
    // changes it, and the plugins bound to the old key go with it.
    vaults.set(
      userId,
      rows
        .map((row) => `${row.providerId}:${row.ciphertext}`)
        .sort()
        .join("\n"),
    );
    const roster = await readHostedRoster(seams.store(), userId, rows, seams.vaultSecret());
    rosters.set(userId, roster);
    return roster;
  };

  return {
    admit: (auth, sessionId) =>
      seams.run(admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CURRENT })),
    admitStarting: (auth, sessionId) =>
      seams.run(admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CLAIMING })),

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

    async prompt(admitted, trigger) {
      const store = seams.store();
      await seedHostedWorkspace(store, admitted.target.userId, seams.now());
      const modelId = seams.openAi()?.modelId;
      const built = await hostedPrompt(store, admitted.target.userId, {
        policy: hostedTurnPolicy(trigger),
        ...(modelId !== undefined ? { model: modelId } : undefined),
      });
      return built.text;
    },

    async standingContext(admitted) {
      const { userId } = admitted.target;
      const now = seams.now();
      const [roster, defaults, facts, recent] = await Promise.all([
        rosterOf(userId),
        seams.run(readWorkspaceDefaults(userId)),
        seams.store().facts.list(userId),
        readRecentMessages(
          seams.run,
          admitted.target,
          CATALOG_TOOL_SET,
          BRAIN_HOST.RECENT_MESSAGES,
        ),
      ]);
      return hostedStandingContext({
        roster,
        rosterText: brainRosterOf(roster, now).text,
        defaults,
        facts,
        recent,
        now,
      });
    },

    async seed(admitted) {
      const recent = await readRecentMessages(
        seams.run,
        admitted.target,
        CATALOG_TOOL_SET,
        BRAIN_HOST.SEED_MESSAGES,
      );
      return rotationSeedText(recent, seams.now());
    },

    toolDeclarations: (turn) => hostedToolDeclarations(turn.trigger),

    async runTool(name, binding, input, context) {
      // Admitted again as the call runs, not only as the tools were resolved:
      // a conversation that rotated to a newer session mid-turn refuses the
      // old session's calls here, so no effect lands without a turn record.
      const standing = await seams.run(
        admitConversation(context.session.auth, {
          id: context.session.id,
          standing: SESSION_STANDING.CURRENT,
        }),
      );
      if (!standing.ok) return { status: ACTION_RESULT_STATUS.REJECTED, reason: standing.refusal };
      const { userId } = binding.target;
      const roster = () => rosterOf(userId);
      const transcripts = hostedTranscriptReads({
        run: seams.run,
        userId,
        roster,
        pluginFor: pluginFor(userId),
        now: seams.now,
      });
      const carrier = hostedActionCarrier({
        roster,
        defaults: () => seams.run(readWorkspaceDefaults(userId)),
        facts: hostedFactsWriter(seams.store(), userId, seams.now),
        apiKey: (providerId) => seams.providerKey(userId, providerId),
        execute: seams.executeAction,
      });
      return runHostedTool(
        name,
        input,
        context,
        {
          conversation: binding.target,
          roster,
          carrier,
          transcripts,
          workspace: hostedWorkspaceAccess(seams.store(), userId, seams.now),
          now: seams.now,
        },
        { trigger: binding.turn.trigger, turnId: binding.turn.turnId, runId: binding.turn.turnId },
      );
    },

    model(admitted) {
      const access = seams.openAi();
      if (!access) return undefined;
      return meteredModel(openAiBrainModel(access.apiKey, access.modelId), () =>
        seams.spend(admitted.target.userId),
      );
    },

    sessionStarted: (admitted, sessionId) =>
      seams.run(claimRuntimeSession(admitted.target, sessionId, new Date(seams.now()))),

    relay: (event, admitted, session, state) => {
      const model = seams.scriptedModel()
        ? BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID
        : seams.openAi()?.modelId;
      return relay.handle(event, {
        sessionId: session.id,
        target: admitted.target,
        turn: turnKindOf(session.auth.current),
        ...(model !== undefined ? { model } : undefined),
        state,
      });
    },
  };
}
