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

export interface RosterDiffWorkspace {
  readonly providerId: CloudAgentProviderId;
  readonly providerWorkspaceId: string;
  readonly name?: string;
}

export interface RosterStatusTransition {
  readonly session: RosterDiffSession;
  readonly from: SessionStatus;
  readonly to: SessionStatus;
}

export interface RosterLineChange {
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
