import {
  type CloudAgentProviderId,
  type ProviderSessionObservation,
  type Schema,
  type SessionStatus,
  s,
  TEXT_ENDS,
} from "../core.js";
import {
  cloudProviderIdSchema,
  type ObservedRoster,
  parseStoredJson,
  rosterProvider,
  sessionStatusSchema,
} from "./observed-roster.js";

/**
 * What changed between two consecutive snapshots of one user's roster, as a
 * pure function of the two. It names the changes the brain host wakes on —
 * a session appearing or vanishing, a status transition, an error line or a
 * workspace's lifecycle words moving, a workspace coming or going — and
 * nothing else: a title edit or a fresher timestamp is the same session
 * still standing. First sight is not a diff: with no previous snapshot there
 * is nothing to have changed from, so the caller records none.
 */

/** How a diff names a session: its identity and what the next snapshot showed of it. */
export interface RosterDiffSession {
  readonly providerId: CloudAgentProviderId;
  readonly providerSessionId: string;
  readonly title: string;
  readonly status: SessionStatus;
  readonly workspaceId?: string;
  readonly workspaceName?: string;
}

interface RosterDiffWorkspace {
  readonly providerId: CloudAgentProviderId;
  readonly providerWorkspaceId: string;
  readonly name?: string;
}

interface RosterStatusTransition {
  readonly session: RosterDiffSession;
  readonly from: SessionStatus;
  readonly to: SessionStatus;
}

interface RosterLineChange {
  readonly session: RosterDiffSession;
  readonly from?: string;
  readonly to?: string;
}

export interface RosterDiff {
  readonly appeared: readonly RosterDiffSession[];
  readonly vanished: readonly RosterDiffSession[];
  readonly statusChanged: readonly RosterStatusTransition[];
  readonly errorChanged: readonly RosterLineChange[];
  /** The workspace lifecycle words a session carries as its activity — initializing, updating — moving. */
  readonly activityChanged: readonly RosterLineChange[];
  readonly workspacesAppeared: readonly RosterDiffWorkspace[];
  readonly workspacesVanished: readonly RosterDiffWorkspace[];
}

function diffSession(
  providerId: CloudAgentProviderId,
  observation: ProviderSessionObservation,
): RosterDiffSession {
  const workspace = observation.workspace;
  return {
    providerId,
    providerSessionId: observation.providerSessionId,
    title: observation.title,
    status: observation.status,
    ...(workspace ? { workspaceId: workspace.providerWorkspaceId } : undefined),
    ...(workspace?.name ? { workspaceName: workspace.name } : undefined),
  };
}

type ObservationsById = ReadonlyMap<string, ProviderSessionObservation>;
type WorkspacesById = ReadonlyMap<string, RosterDiffWorkspace>;

interface IndexedRoster {
  readonly sessions: ReadonlyMap<CloudAgentProviderId, ObservationsById>;
  readonly workspaces: ReadonlyMap<CloudAgentProviderId, WorkspacesById>;
}

function indexRoster(roster: ObservedRoster): IndexedRoster {
  const sessions = new Map<CloudAgentProviderId, Map<string, ProviderSessionObservation>>();
  const workspaces = new Map<CloudAgentProviderId, Map<string, RosterDiffWorkspace>>();
  for (const provider of roster.providers) {
    const byId = new Map<string, ProviderSessionObservation>();
    const workspacesById = new Map<string, RosterDiffWorkspace>();
    for (const observation of provider.observations) {
      if (!byId.has(observation.providerSessionId)) {
        byId.set(observation.providerSessionId, observation);
      }
      const workspace = observation.workspace;
      if (workspace && !workspacesById.has(workspace.providerWorkspaceId)) {
        workspacesById.set(workspace.providerWorkspaceId, {
          providerId: provider.providerId,
          providerWorkspaceId: workspace.providerWorkspaceId,
          ...(workspace.name ? { name: workspace.name } : undefined),
        });
      }
    }
    sessions.set(provider.providerId, byId);
    workspaces.set(provider.providerId, workspacesById);
  }
  return { sessions, workspaces };
}

function providerIds(previous: IndexedRoster, next: IndexedRoster): CloudAgentProviderId[] {
  return [...new Set([...previous.sessions.keys(), ...next.sessions.keys()])];
}

const EMPTY_SESSIONS: ObservationsById = new Map();
const EMPTY_WORKSPACES: WorkspacesById = new Map();

function lineChange(
  session: RosterDiffSession,
  from: string | undefined,
  to: string | undefined,
): RosterLineChange | undefined {
  if (from === to) return undefined;
  return {
    session,
    ...(from !== undefined ? { from } : undefined),
    ...(to !== undefined ? { to } : undefined),
  };
}

export function rosterDiff(previous: ObservedRoster, next: ObservedRoster): RosterDiff {
  const before = indexRoster(previous);
  const after = indexRoster(next);
  const appeared: RosterDiffSession[] = [];
  const vanished: RosterDiffSession[] = [];
  const statusChanged: RosterStatusTransition[] = [];
  const errorChanged: RosterLineChange[] = [];
  const activityChanged: RosterLineChange[] = [];
  const workspacesAppeared: RosterDiffWorkspace[] = [];
  const workspacesVanished: RosterDiffWorkspace[] = [];

  for (const providerId of providerIds(before, after)) {
    const earlier = before.sessions.get(providerId) ?? EMPTY_SESSIONS;
    const later = after.sessions.get(providerId) ?? EMPTY_SESSIONS;
    for (const [sessionId, observation] of later) {
      const was = earlier.get(sessionId);
      const session = diffSession(providerId, observation);
      if (!was) {
        appeared.push(session);
        continue;
      }
      if (was.status !== observation.status) {
        statusChanged.push({ session, from: was.status, to: observation.status });
      }
      const error = lineChange(session, was.detail?.error, observation.detail?.error);
      if (error) errorChanged.push(error);
      const activity = lineChange(session, was.detail?.activity, observation.detail?.activity);
      if (activity) activityChanged.push(activity);
    }
    for (const [sessionId, observation] of earlier) {
      if (!later.has(sessionId)) vanished.push(diffSession(providerId, observation));
    }
    const earlierWorkspaces = before.workspaces.get(providerId) ?? EMPTY_WORKSPACES;
    const laterWorkspaces = after.workspaces.get(providerId) ?? EMPTY_WORKSPACES;
    for (const [workspaceId, workspace] of laterWorkspaces) {
      if (!earlierWorkspaces.has(workspaceId)) workspacesAppeared.push(workspace);
    }
    for (const [workspaceId, workspace] of earlierWorkspaces) {
      if (!laterWorkspaces.has(workspaceId)) workspacesVanished.push(workspace);
    }
  }

  return {
    appeared,
    vanished,
    statusChanged,
    errorChanged,
    activityChanged,
    workspacesAppeared,
    workspacesVanished,
  };
}

export function rosterDiffIsEmpty(diff: RosterDiff): boolean {
  return (
    diff.appeared.length === 0 &&
    diff.vanished.length === 0 &&
    diff.statusChanged.length === 0 &&
    diff.errorChanged.length === 0 &&
    diff.activityChanged.length === 0 &&
    diff.workspacesAppeared.length === 0 &&
    diff.workspacesVanished.length === 0
  );
}

export function encodeRosterDiff(diff: RosterDiff): string {
  return JSON.stringify(diff);
}

const storedText = s.text({ ends: TEXT_ENDS.KEEP, allowEmpty: true });
const optionalText = storedText.optional();

const diffSessionSchema: Schema<RosterDiffSession> = s.record({
  providerId: cloudProviderIdSchema,
  providerSessionId: storedText,
  title: storedText,
  status: sessionStatusSchema,
  workspaceId: optionalText,
  workspaceName: optionalText,
});

const diffWorkspaceSchema: Schema<RosterDiffWorkspace> = s.record({
  providerId: cloudProviderIdSchema,
  providerWorkspaceId: storedText,
  name: optionalText,
});

const statusTransitionSchema: Schema<RosterStatusTransition> = s.record({
  session: diffSessionSchema,
  from: sessionStatusSchema,
  to: sessionStatusSchema,
});

const lineChangeSchema: Schema<RosterLineChange> = s.record({
  session: diffSessionSchema,
  from: optionalText,
  to: optionalText,
});

const rosterDiffSchema: Schema<RosterDiff> = s.record({
  appeared: s.array(diffSessionSchema),
  vanished: s.array(diffSessionSchema),
  statusChanged: s.array(statusTransitionSchema),
  errorChanged: s.array(lineChangeSchema),
  activityChanged: s.array(lineChangeSchema),
  workspacesAppeared: s.array(diffWorkspaceSchema),
  workspacesVanished: s.array(diffWorkspaceSchema),
});

/** Reads a stored diff, or nothing for a payload that is not one this build wrote. */
export function decodeRosterDiff(payload: string): RosterDiff | undefined {
  return rosterDiffSchema.parse(parseStoredJson(payload));
}

/**
 * The roster the brain has now heard, after a visit carried some of the
 * change from `previous` to `next` and not the rest: `next` for every
 * session the visit carried, and `previous` for every session it did not,
 * so an uncarried appearance is still absent, an uncarried vanishing still
 * present, and an uncarried transition still at its earlier state, and the
 * next visit derives each of them again. The caller names the uncarried
 * sessions as exactly those whose wakes it held back, so a change no wake
 * is derived from — a workspace coming or going, a field the wake ignores —
 * counts as carried and settles rather than deriving again on every visit.
 * Projects and the key fingerprint follow `next`.
 */
export function rosterCarrying(
  previous: ObservedRoster,
  next: ObservedRoster,
  carried: (providerId: CloudAgentProviderId, providerSessionId: string) => boolean,
): ObservedRoster {
  const providerIds = [
    ...next.providers.map((provider) => provider.providerId),
    ...previous.providers
      .map((provider) => provider.providerId)
      .filter((id) => rosterProvider(next, id) === undefined),
  ];
  return {
    version: next.version,
    providers: providerIds.flatMap((providerId) => {
      const before = rosterProvider(previous, providerId);
      const after = rosterProvider(next, providerId);
      const standing = after ?? before;
      if (standing === undefined) return [];
      const observations: ProviderSessionObservation[] = [];
      for (const observation of after?.observations ?? []) {
        if (carried(providerId, observation.providerSessionId)) {
          observations.push(observation);
          continue;
        }
        const was = before?.observations.find(
          (earlier) => earlier.providerSessionId === observation.providerSessionId,
        );
        if (was) observations.push(was);
      }
      for (const was of before?.observations ?? []) {
        const stillThere = after?.observations.some(
          (observation) => observation.providerSessionId === was.providerSessionId,
        );
        if (!stillThere && !carried(providerId, was.providerSessionId)) observations.push(was);
      }
      return [{ ...standing, observations }];
    }),
  };
}

/**
 * The earlier roster made comparable to the later one before a diff: a
 * provider observed under the same key on both sides is kept as it was,
 * and one whose key was replaced, added, or removed is taken from `next`
 * as it stands, so the diff names no change for it. Two rosters under
 * different keys are two accounts' rosters and their difference is not
 * news; the pass refuses the same comparison and records no change, and
 * the bookmark that derives from this settles on the new key at once.
 */
export function rosterComparable(previous: ObservedRoster, next: ObservedRoster): ObservedRoster {
  const kept = previous.providers.flatMap((provider) => {
    const later = rosterProvider(next, provider.providerId);
    if (later === undefined) return [];
    return [later.keyFingerprint === provider.keyFingerprint ? provider : later];
  });
  const added = next.providers.filter(
    (provider) => rosterProvider(previous, provider.providerId) === undefined,
  );
  return { version: next.version, providers: [...kept, ...added] };
}
