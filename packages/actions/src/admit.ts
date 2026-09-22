/**
 * The one gauntlet an action runs, and the only place a {@link ValidatedAction}
 * comes from. In order: the guard (the turn that asked still stands), the
 * roster (a fresh read of its own, and the target has to be one it holds), the
 * advertisement (the advertised entry itself becomes what the action carries — a
 * control, an agent kind, a rename target, a listed project — so nothing a
 * caller sent can redirect the effect), then the bounds (the developer's own
 * text, refused rather than cut). The guard is asked again after every read,
 * so an action whose turn ended while the roster was refreshing refuses rather
 * than dispatching.
 *
 * The gauntlet is one Effect, {@link admitEffect}, failing with the refusal as
 * a typed error, and every caller composes it into its own.
 *
 * Admission decides only whether an action may run. Which acts a conversation may
 * ask for at all was the effective tool policy's decision before a call left
 * the model, and who opened the turn is recorded on what admission mints and
 * consulted as a permission by nothing.
 */

import type { RunOrigin } from "@sidecar/runtime/vocabulary";
import {
  advertisedActionFor,
  advertisedControl,
  maximumWorkspaceNameLength,
  type ObservedWorkspaceProject,
  type Session,
  type SessionIdentity,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  type Admitted,
  type UnparsedWireValue,
  type WireRecord,
  text as wireText,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Data, Effect, Result, type Schema } from "effect";
import {
  ACTION_KIND,
  type ActionKind,
  type ActionPayloads,
  type ActionRequest,
  type CarriedAction,
} from "./action-kinds.js";
import {
  MESSAGE_TEXT,
  OPENING_TASK,
  SESSION_IDENTITY_FIELDS,
  WORKSPACE_NAME,
} from "./action-schemas.js";

/**
 * An action that ran the gauntlet, carrying the turn's origin for Conversation to
 * record. The brand is `@sidecar/wire`'s, whose key nothing anywhere can spell,
 * and {@link admitEffect} below is the one place in the repository that enters
 * the admitted set: everything downstream re-shapes what it already holds. What
 * the brand buys is that admission cannot be skipped by accident; a deliberate
 * `as ValidatedAction` would still compile, since the admitted action is a subtype of
 * its own payload, and that assertion appears nowhere but in `admitEffect`
 * itself — `validated-action.type-test.ts` says both in as many words.
 */
export type ValidatedAction<Kind extends ActionKind = ActionKind> = Admitted<
  CarriedAction<Kind>
> & {
  /** Who opened the turn; recorded, never a permission. */
  readonly origin: RunOrigin;
};

/** Whether the turn an action belongs to still stands, asked again after every await. */
interface ActionGuard {
  isRevoked(): boolean;
  /** Fires on revocation, so a read waited on before the effect settles at once rather than finishing first. */
  readonly signal?: AbortSignal;
}

/**
 * The roster as admission reads it, and never as a caller hands it: `read`
 * answers what the latest observation saw, so the fresh-roster step is
 * admission's own rather than each intake's promise. The read is an effect,
 * run on the fiber the gauntlet itself runs on, so the turn's own
 * cancellation reaches it.
 */
export interface ActionRoster {
  read(): Effect.Effect<readonly Session[]>;
}

/** The projects a creation ask may land in, read the same way and from the same pass. */
interface ActionProjects {
  read(): Effect.Effect<readonly ObservedWorkspaceProject[]>;
  /**
   * The developer's saved tie-breaks, which only ever narrow within what
   * `read` returned: a default can settle an ambiguous ask, never widen where
   * one can land or override a provider or project the ask actually named.
   */
  defaults(): Effect.Effect<{
    defaultProviderId?: string | undefined;
    defaultProjectIds?: Readonly<Partial<Record<string, string>>> | undefined;
  }>;
  /** The models a creation or a spawn may name, per provider, as the build documents them. */
  agentModels(providerId: string): readonly WorkspaceAgentModels[];
}

export interface AdmitContext {
  /**
   * Who opened the turn this action belongs to. Recorded on what admission mints
   * and never consulted as a permission: a developer's ask and an observed
   * session's look run exactly the same admission.
   */
  readonly origin: RunOrigin;
  /** Absent for a row's own press, which opens its turn and its effect in the same breath. */
  readonly guard?: ActionGuard;
  readonly roster: ActionRoster;
  /** Absent in a run that offers none, which then admits no creation. */
  readonly projects?: ActionProjects;
}

/**
 * Why an action was not admitted, in words Luke can say aloud. What rides beside
 * a reason is only ever what the roster the caller already read already told
 * them — the controls a session does advertise, the efforts a model does
 * take — so a refusal is also the correction and never a disclosure.
 */
export const ACTION_REFUSAL = {
  UNREADABLE: "The tool call's arguments were not readable.",
  NO_TOOL: "No such tool exists.",
  TURN_OVER: "Not run: the turn that asked for this action ended before it could start.",
  NO_SESSION: "No observed session matches that identity.",
  NO_MESSAGES: "That session does not take messages right now.",
  MESSAGE_BOUND: "That message is empty or too long.",
  NO_CONTROL: "That session advertises no such control.",
  NO_PROJECT: "No listed project matches that identity.",
  MANY_PROJECTS: "More than one listed project matches; name the project and host.",
  NO_TARGET:
    "No listed project carries that target; a target_id is named only as the projects list gives it, and a project listed without one takes none.",
  NO_PROJECT_AGENT: "That project lists no such agent to start.",
  NAME_A_PROJECT_AGENT: "Name one of the agents that project lists for a new workspace.",
  PROJECT_NAMES_ITSELF: "That project names its own workspaces.",
  NO_SESSION_AGENT: "That session lists no such agent to add.",
  WORKSPACE_NAME_BOUND: `A workspace name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
  SESSION_NAME_BOUND: `A session name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
  CHAT_NAME_BOUND: `A chat name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
  NO_WORKSPACE_RENAME: "That session's workspace cannot be renamed.",
  NO_SESSION_RENAME: "That chat cannot be renamed.",
  TASK_BOUND: "That task is empty or too long.",
  NO_TASK_TAKEN: "That project takes no opening task.",
  TASK_REQUIRED: "That project needs an opening task to create a workspace.",
  NO_MODEL: "No documented model goes by that name here.",
  NO_EFFORT_LEVEL: "That model takes no effort level.",
  EFFORT_NEEDS_MODEL: "An effort rides a model; name the model too.",
} as const;

/** Why an action was not admitted. Disjoint from every carried action, by `kind`. */
export interface Refusal {
  readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
  readonly reason: string;
  readonly kind?: never;
}

function refuse(reason: string): Refusal {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/**
 * The refusal as {@link admitEffect} fails with it: the same sentence a
 * {@link Refusal} carries, since that sentence reaches the action journal and
 * the developer's ear, typed so a caller composing in Effect tells a refusal
 * from a roster read that failed. One tag stands for the whole gauntlet
 * because many reasons are sentences composed from what the roster already
 * told the caller, not members of a fixed set a tag could name.
 */
export class AdmitRefusal extends Data.TaggedError("AdmitRefusal")<{
  readonly reason: string;
}> {}

/** The guard's revocation as an effect: it answers nothing, the moment the signal fires. */
function revocation(signal: AbortSignal): Effect.Effect<undefined> {
  return Effect.callback<undefined>((resume) => {
    if (signal.aborted) {
      resume(Effect.succeed(undefined));
      return;
    }
    const onAbort = () => resume(Effect.succeed(undefined));
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * A read waited on before an effect, held only as long as the guard's
 * standing: once the signal fires the wait answers nothing and the read is
 * interrupted, so its value and any failure are nobody's, and the `isRevoked`
 * check that follows every such read refuses the action before anything is
 * dispatched. A guard with no signal — a row's own press — waits the read out.
 */
export function guardedRead<Value, Failure, Requirements>(
  read: Effect.Effect<Value, Failure, Requirements>,
  guard: ActionGuard | undefined,
): Effect.Effect<Value | undefined, Failure, Requirements> {
  const signal = guard?.signal;
  if (!signal) return read;
  // Interruptible on purpose: the race interrupts whichever of the two lost,
  // and a caller that dispatches its effect uninterruptibly — the turn
  // carrying an action through the journal — would otherwise wait on a loser
  // that can never be interrupted. The window this opens is the wait on the
  // read itself, which is the one place a turn that ended wants to be left.
  return Effect.interruptible(Effect.raceFirst(read, revocation(signal)));
}

/**
 * The reads one admission makes, each made at most once and each held only as
 * long as the guard's standing. `undefined` means the turn ended mid-read, and
 * the admitter that asked refuses rather than deciding on a half-read picture.
 */
interface AdmittedReads {
  readonly sessions: Effect.Effect<readonly Session[] | undefined>;
  readonly projects: Effect.Effect<readonly ObservedWorkspaceProject[] | undefined>;
  readonly defaults: Effect.Effect<
    | {
        defaultProviderId?: string | undefined;
        defaultProjectIds?: Readonly<Partial<Record<string, string>>> | undefined;
      }
    | undefined
  >;
}

/**
 * The reads as admission performs them itself, on the readers the context
 * carries and never on a copy: each is cached so a second admitter asking
 * reads the same picture, and a read that fails is a defect, since a roster
 * that cannot be read is not a refusal Luke has words for.
 */
function admittedReads(context: AdmitContext): Effect.Effect<AdmittedReads> {
  const guarded = <T>(read: () => Effect.Effect<T>): Effect.Effect<T | undefined> =>
    Effect.suspend(() => {
      if (context.guard?.isRevoked()) return Effect.succeed(undefined);
      return guardedRead(read(), context.guard).pipe(
        Effect.map((value) => (context.guard?.isRevoked() ? undefined : value)),
      );
    });
  const projects = context.projects;
  const noProjects = Effect.succeed<readonly ObservedWorkspaceProject[]>([]);
  const noDefaults = Effect.succeed({});
  return Effect.all({
    sessions: Effect.cached(guarded(() => context.roster.read())),
    projects: Effect.cached(guarded(() => (projects ? projects.read() : noProjects))),
    defaults: Effect.cached(guarded(() => (projects ? projects.defaults() : noDefaults))),
  });
}

function textArgument(fields: WireRecord, key: string): string | undefined {
  return wireText(fields[key]);
}

/** A field schema read the way the old `.parse()` did: the value, or nothing it refused. */
function wireParse<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

function sessionFrom(
  fields: WireRecord,
  sessions: readonly Session[],
): { session: Session; identity: SessionIdentity } | Refusal {
  const providerId = wireParse(SESSION_IDENTITY_FIELDS.provider_id, fields.provider_id);
  const providerSessionId = wireParse(
    SESSION_IDENTITY_FIELDS.provider_session_id,
    fields.provider_session_id,
  );
  const session = sessions.find(
    (candidate) =>
      candidate.providerId === providerId && candidate.providerSessionId === providerSessionId,
  );
  if (!session) return refuse(ACTION_REFUSAL.NO_SESSION);
  return {
    session,
    identity: {
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    },
  };
}

/**
 * The one entry a spoken name picks out. Spoken names arrive with their case
 * retold rather than copied, so the match forgives case alone — never
 * spelling — and only while it stays unambiguous: two advertised entries apart
 * only in case are not a guess Luke gets to make.
 */
function namedOnce<Entry>(
  entries: readonly Entry[],
  word: string,
  nameOf: (entry: Entry) => string,
  fold: (name: string) => string,
): Entry | undefined {
  const folded = fold(word);
  const named = entries.filter((candidate) => fold(nameOf(candidate)) === folded);
  return (
    named.find((candidate) => nameOf(candidate) === word) ??
    (named.length === 1 ? named[0] : undefined)
  );
}

/**
 * A model's name as it is retold rather than copied: `fable-5.1`, `Fable 5.1`,
 * and `fable-5-1` are one name, so case and the punctuation between the
 * parts are folded away and only the letters and digits are compared. A
 * label and an id that fold alike name the same model, which is what lets
 * both be offered as the one name.
 */
function foldModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The refusal for a model named beside an agent kind that runs no model by that name. */
function agentRunsNoModel(agent: string): Refusal {
  return refuse(`A ${agent} agent runs no model by that name.`);
}

/**
 * Resolves a model the developer named — by the label the guide lists it
 * under, or its id — to the wire pairing an endpoint takes, held to the
 * build's documented entries for the provider. An exact name wins; a name
 * that matches only once folded ({@link foldModelName}) is taken while it
 * stays unambiguous. The effort, when named, must be one the resolved
 * model's own agent documents: the pairing is validated as the whole it will
 * be sent as.
 */
function resolveWorkspaceAgentModel(
  entries: readonly WorkspaceAgentModels[],
  modelWord: string,
  effortWord: string | undefined,
): { selection: WorkspaceAgentSelection } | { refusal: Refusal; unnamedModel: boolean } {
  const word = modelWord.trim();
  const folded = foldModelName(word);
  const candidates = entries
    .flatMap((entry) => entry.models.map((model) => ({ entry, model })))
    .filter(({ model }) => [model.id, model.label].some((name) => foldModelName(name) === folded));
  const named =
    candidates.find(({ model }) => model.id === word || model.label === word) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (!named) return { refusal: refuse(ACTION_REFUSAL.NO_MODEL), unnamedModel: true };
  let effort: string | undefined;
  if (effortWord !== undefined) {
    const normalizedEffort = effortWord.trim().toLowerCase();
    effort = named.entry.efforts.find((candidate) => candidate.toLowerCase() === normalizedEffort);
    if (!effort) {
      return {
        unnamedModel: false,
        refusal:
          named.entry.efforts.length > 0
            ? refuse(`That model's effort is one of ${named.entry.efforts.join(", ")}.`)
            : refuse(ACTION_REFUSAL.NO_EFFORT_LEVEL),
      };
    }
  }
  const selection: WorkspaceAgentSelection = { agent: named.entry.agent, model: named.model.id };
  if (effort) selection.effort = effort;
  return { selection };
}

type AdmittedPayload<Kind extends ActionKind> = ({ kind: Kind } & ActionPayloads[Kind]) | Refusal;

/** One kind's gauntlet over the reads admission made: the payload it carries, or the refusal. */
type Admitter<Kind extends ActionKind> = (
  fields: WireRecord,
  context: AdmitContext,
  reads: AdmittedReads,
) => Effect.Effect<AdmittedPayload<Kind>>;

const admittedSession = (
  fields: WireRecord,
  reads: AdmittedReads,
): Effect.Effect<{ session: Session; identity: SessionIdentity } | Refusal> =>
  Effect.map(reads.sessions, (sessions) =>
    sessions ? sessionFrom(fields, sessions) : refuse(ACTION_REFUSAL.TURN_OVER),
  );

const admitMessage: Admitter<typeof ACTION_KIND.MESSAGE> = (fields, _context, reads) =>
  Effect.gen(function* () {
    const found = yield* admittedSession(fields, reads);
    if ("status" in found) return found;
    if (!advertisedActionFor(found.session, ACTION_KIND.MESSAGE)) {
      return refuse(ACTION_REFUSAL.NO_MESSAGES);
    }
    const text = wireParse(MESSAGE_TEXT, fields.text);
    if (!text) return refuse(ACTION_REFUSAL.MESSAGE_BOUND);
    return { kind: ACTION_KIND.MESSAGE, identity: found.identity, text };
  });

const admitControl: Admitter<typeof ACTION_KIND.CONTROL> = (fields, _context, reads) =>
  Effect.gen(function* () {
    const found = yield* admittedSession(fields, reads);
    if ("status" in found) return found;
    const controlId = textArgument(fields, "control_id");
    // The advertised control itself is what the action carries: the caller's copy
    // names which one, and never what the effect is built from.
    const control = controlId ? advertisedControl(found.session, controlId) : undefined;
    if (!control) return refuse(ACTION_REFUSAL.NO_CONTROL);
    return { kind: ACTION_KIND.CONTROL, identity: found.identity, control };
  });

const admitCreateWorkspace: Admitter<typeof ACTION_KIND.CREATE_WORKSPACE> = (
  fields,
  context,
  reads,
) =>
  Effect.gen(function* () {
    // A creation ask names a project rather than a session, so it is admitted
    // against the projects the conversation was shown — the same discipline,
    // against the list that actually offered it.
    const listed = yield* reads.projects;
    const saved = yield* reads.defaults;
    if (!listed || !saved) return refuse(ACTION_REFUSAL.TURN_OVER);
    const providerId = textArgument(fields, "provider_id");
    const projectId = textArgument(fields, "project_id");
    const targetId = textArgument(fields, "target_id");
    const namedProjects = listed.filter(
      (candidate) =>
        (!providerId || candidate.providerId === providerId) &&
        (!projectId || candidate.providerProjectId === projectId),
    );
    // A target picks out a host among the projects the ask named — one
    // repository a provider reports on several hosts under one project id — so
    // it narrows only where a listed project carries one. A project listed
    // without a target has no host to pick, and a target the ask invented for it
    // cannot hide it: the action still carries the listed entry's own identity
    // and never the ask's word. Where the named projects do carry targets and
    // none is the one asked for, the refusal names the target, so the correction
    // is said rather than guessed at or sent on to a target-less twin.
    let matchingProjects = namedProjects;
    if (targetId) {
      const onTarget = namedProjects.filter((candidate) => candidate.providerTargetId === targetId);
      matchingProjects =
        onTarget.length > 0
          ? onTarget
          : namedProjects.filter((candidate) => candidate.providerTargetId === undefined);
      if (matchingProjects.length === 0 && namedProjects.length > 0) {
        return refuse(ACTION_REFUSAL.NO_TARGET);
      }
    }
    // The saved defaults settle only what the ask left unnamed: no provider
    // named sends a still-ambiguous ask to the default provider while it is
    // offering, and no project named sends it on to that provider's chosen
    // project. Neither step can leave the listed set, and an ask that named its
    // own provider or project is never overridden.
    if (!providerId && saved.defaultProviderId && matchingProjects.length > 1) {
      const offeredByDefault = matchingProjects.filter(
        (candidate) => candidate.providerId === saved.defaultProviderId,
      );
      if (offeredByDefault.length > 0) matchingProjects = offeredByDefault;
    }
    // A provider's chosen project settles which project, never which provider:
    // while candidates still span providers, one provider's saved project must
    // not quietly decide an ask the developer left open between them.
    const [firstMatch] = matchingProjects;
    const oneProviderMatches =
      firstMatch !== undefined &&
      matchingProjects.every((candidate) => candidate.providerId === firstMatch.providerId);
    if (!projectId && oneProviderMatches && matchingProjects.length > 1) {
      const chosenProjects = matchingProjects.filter(
        (candidate) =>
          saved.defaultProjectIds?.[candidate.providerId] ===
          workspaceProjectSelectionId(candidate),
      );
      if (chosenProjects.length === 1) matchingProjects = chosenProjects;
    }
    const [project] = matchingProjects;
    if (matchingProjects.length !== 1 || project === undefined) {
      return refuse(
        matchingProjects.length > 1 ? ACTION_REFUSAL.MANY_PROJECTS : ACTION_REFUSAL.NO_PROJECT,
      );
    }
    const requestedAgent = textArgument(fields, "agent");
    const spawnable = project.spawnableAgents;
    const namedAgent =
      spawnable === undefined || requestedAgent === undefined
        ? undefined
        : namedOnce(
            spawnable,
            requestedAgent,
            (agentKind) => agentKind,
            (name) => name.toLocaleLowerCase(),
          );
    const agent = namedAgent ?? project.defaultAgent;
    if (spawnable && (!agent || !spawnable.includes(agent))) {
      return refuse(agent ? ACTION_REFUSAL.NO_PROJECT_AGENT : ACTION_REFUSAL.NAME_A_PROJECT_AGENT);
    }
    let name: string | undefined;
    if (fields.name !== undefined) {
      if (project.namesItself) return refuse(ACTION_REFUSAL.PROJECT_NAMES_ITSELF);
      name = wireParse(WORKSPACE_NAME, fields.name);
      if (!name) return refuse(ACTION_REFUSAL.WORKSPACE_NAME_BOUND);
    }
    // The task is held to the project's own word for it: a project that takes
    // none cannot be handed one, a project that needs one cannot be created
    // without it, and the text itself is bounded like the message it is.
    let task: string | undefined;
    if (fields.task !== undefined) {
      if (project.taskSupport === WORKSPACE_TASK_SUPPORT.NONE) {
        return refuse(ACTION_REFUSAL.NO_TASK_TAKEN);
      }
      task = wireParse(OPENING_TASK, fields.task);
      if (!task) return refuse(ACTION_REFUSAL.TASK_BOUND);
    } else if (project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
      return refuse(ACTION_REFUSAL.TASK_REQUIRED);
    }
    // A model named for this one creation resolves against the provider's own
    // documented table, and the effort only ever rides a model: alone it has
    // nothing documented to attach to. Note that the brain's tool declares no
    // model, agent, or effort and its call is cut to its declaration before
    // admission, so a model here is a device picker's own word, never the
    // brain's guess. The model decides which agent runs it,
    // so an agent the ask named beside it has to be that agent: a claude
    // asked for beside a codex model is a refusal, never a Codex workspace,
    // exactly as a spawn's mismatch is.
    const spokenModel = textArgument(fields, "model");
    const spokenEffort = textArgument(fields, "effort");
    if (spokenEffort !== undefined && spokenModel === undefined) {
      return refuse(ACTION_REFUSAL.EFFORT_NEEDS_MODEL);
    }
    let agentSelection: WorkspaceAgentSelection | undefined;
    if (spokenModel !== undefined) {
      const resolved = resolveWorkspaceAgentModel(
        context.projects?.agentModels(project.providerId) ?? [],
        spokenModel,
        spokenEffort,
      );
      if ("refusal" in resolved) return resolved.refusal;
      // Only an agent the ask itself named can contradict the model; the
      // project's default agent, filled in above, is no word of the developer's.
      const askedAgent = namedAgent ?? requestedAgent;
      if (
        askedAgent !== undefined &&
        askedAgent.toLocaleLowerCase() !== resolved.selection.agent.toLocaleLowerCase()
      ) {
        return agentRunsNoModel(askedAgent);
      }
      agentSelection = resolved.selection;
    }
    const action: {
      kind: typeof ACTION_KIND.CREATE_WORKSPACE;
    } & ActionPayloads[typeof ACTION_KIND.CREATE_WORKSPACE] = {
      kind: ACTION_KIND.CREATE_WORKSPACE,
      providerId: project.providerId,
      providerProjectId: project.providerProjectId,
    };
    if (project.providerTargetId) action.providerTargetId = project.providerTargetId;
    if (agent) action.agent = agent;
    if (name) action.name = name;
    if (task) action.task = task;
    if (agentSelection) action.agentSelection = agentSelection;
    return action;
  });

const admitAddAgent: Admitter<typeof ACTION_KIND.ADD_AGENT> = (fields, context, reads) =>
  Effect.gen(function* () {
    const found = yield* admittedSession(fields, reads);
    if ("status" in found) return found;
    const { session, identity } = found;
    // The agent must be one this session's own roster entry listed: the list is
    // the provider's word for what its endpoint takes, so an ask outside it is
    // refused rather than forwarded to be refused.
    const asked = textArgument(fields, "agent");
    const advertised = advertisedActionFor(session, ACTION_KIND.ADD_AGENT)?.agents ?? [];
    const agent = asked === undefined ? undefined : advertised.find((entry) => entry === asked);
    if (agent === undefined) return refuse(ACTION_REFUSAL.NO_SESSION_AGENT);
    let name: string | undefined;
    if (fields.name !== undefined) {
      name = wireParse(WORKSPACE_NAME, fields.name);
      if (!name) return refuse(ACTION_REFUSAL.SESSION_NAME_BOUND);
    }
    let task: string | undefined;
    if (fields.task !== undefined) {
      task = wireParse(OPENING_TASK, fields.task);
      if (!task) return refuse(ACTION_REFUSAL.TASK_BOUND);
    }
    // A model named for this one agent resolves within the asked-for kind alone:
    // the developer's chosen agent is never re-decided by the model they named
    // beside it, so a mismatch is a refusal rather than a swap. As for a
    // creation, only a device's own picker reaches here with a model.
    const spokenModel = textArgument(fields, "model");
    const spokenEffort = textArgument(fields, "effort");
    if (spokenEffort !== undefined && spokenModel === undefined) {
      return refuse(ACTION_REFUSAL.EFFORT_NEEDS_MODEL);
    }
    let selection: WorkspaceAgentSelection | undefined;
    if (spokenModel !== undefined) {
      const entries = (context.projects?.agentModels(session.providerId) ?? []).filter(
        (candidate) => candidate.agent === agent,
      );
      const resolved = resolveWorkspaceAgentModel(entries, spokenModel, spokenEffort);
      if ("refusal" in resolved) {
        return resolved.unnamedModel ? agentRunsNoModel(agent) : resolved.refusal;
      }
      selection = resolved.selection;
    }
    const action: {
      kind: typeof ACTION_KIND.ADD_AGENT;
    } & ActionPayloads[typeof ACTION_KIND.ADD_AGENT] = {
      kind: ACTION_KIND.ADD_AGENT,
      identity,
      agent,
    };
    if (name) action.name = name;
    if (task) action.task = task;
    if (selection) action.model = selection.model;
    if (selection?.effort) action.effort = selection.effort;
    return action;
  });

const admitRenameWorkspace: Admitter<typeof ACTION_KIND.RENAME_WORKSPACE> = (
  fields,
  _context,
  reads,
) =>
  Effect.gen(function* () {
    const found = yield* admittedSession(fields, reads);
    if ("status" in found) return found;
    // Only a session whose roster entry advertised renaming has a workspace a
    // rename can land on. The action carries the identity and the name, never the
    // target: the workspace is resolved from the observed entry, so a caller's
    // copy of one never redirects the effect.
    if (!advertisedActionFor(found.session, ACTION_KIND.RENAME_WORKSPACE)) {
      return refuse(ACTION_REFUSAL.NO_WORKSPACE_RENAME);
    }
    const name = wireParse(WORKSPACE_NAME, fields.name);
    if (!name) return refuse(ACTION_REFUSAL.WORKSPACE_NAME_BOUND);
    return { kind: ACTION_KIND.RENAME_WORKSPACE, identity: found.identity, name };
  });

const admitRenameSession: Admitter<typeof ACTION_KIND.RENAME_SESSION> = (fields, _context, reads) =>
  Effect.gen(function* () {
    const found = yield* admittedSession(fields, reads);
    if ("status" in found) return found;
    if (!advertisedActionFor(found.session, ACTION_KIND.RENAME_SESSION)) {
      return refuse(ACTION_REFUSAL.NO_SESSION_RENAME);
    }
    const name = wireParse(WORKSPACE_NAME, fields.name);
    if (!name) return refuse(ACTION_REFUSAL.CHAT_NAME_BOUND);
    return { kind: ACTION_KIND.RENAME_SESSION, identity: found.identity, name };
  });

const ADMITTERS = {
  [ACTION_KIND.MESSAGE]: admitMessage,
  [ACTION_KIND.CONTROL]: admitControl,
  [ACTION_KIND.CREATE_WORKSPACE]: admitCreateWorkspace,
  [ACTION_KIND.ADD_AGENT]: admitAddAgent,
  [ACTION_KIND.RENAME_WORKSPACE]: admitRenameWorkspace,
  [ACTION_KIND.RENAME_SESSION]: admitRenameSession,
} as const satisfies { [K in ActionKind]: Admitter<K> };

const turnOver = Effect.fail(new AdmitRefusal({ reason: ACTION_REFUSAL.TURN_OVER }));

/**
 * The one gauntlet that mints a {@link ValidatedAction}, as an Effect that
 * fails with the refusal. Everything a performer or an adapter needs to have
 * been checked is checked here, once, and the type it succeeds with is how
 * every path is held to having run it. A roster read that fails is a defect,
 * not a refusal: the caller that ran the effect sees the read's own failure.
 */
export function admitEffect<Kind extends ActionKind>(
  request: ActionRequest<Kind>,
  context: AdmitContext,
): Effect.Effect<ValidatedAction<Kind>, AdmitRefusal> {
  return Effect.gen(function* () {
    if (context.guard?.isRevoked()) return yield* turnOver;
    // SAFETY: the table is keyed by the same union `request.kind` ranges over, so
    // the entry selected is the admitter written for this request's own kind.
    const admitter = ADMITTERS[request.kind] as Admitter<Kind>;
    const admitted = yield* admitter(request.fields, context, yield* admittedReads(context));
    if ("status" in admitted)
      return yield* Effect.fail(new AdmitRefusal({ reason: admitted.reason }));
    // Asked once more after every read admission made, so an action whose turn
    // ended while the roster was refreshing refuses rather than being minted.
    if (context.guard?.isRevoked()) return yield* turnOver;
    // SAFETY: the brand is nominal and this is its one producer in the
    // repository; the payload stands exactly as the admitter built it.
    return { ...admitted, origin: context.origin } as ValidatedAction<Kind>;
  });
}
