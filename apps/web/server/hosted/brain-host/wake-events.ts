import {
  BRAIN_WAKE_KIND,
  type BrainWakeEvent,
  type Session,
  type SessionIdentity,
  type WireRecord,
} from "../../core.js";
import type { RosterDiff, RosterDiffSession } from "../roster-diff.js";
import type { HostedRoster } from "./roster.js";

/**
 * The wakes a stored roster diff becomes: one event per session the diff
 * named, at the instant of the snapshot that showed the change, carrying the
 * session as the snapshot now holds it and the changes the diff recorded in
 * words the turn's opening renders as data. A session the snapshot no longer
 * holds is named with what the diff last knew of it and nothing is read for
 * it. The transcript each live session gained is read at capture, from its
 * cursor, by the brain itself.
 */

const SESSION_CHANGE = {
  APPEARED: "appeared",
  VANISHED: "vanished",
} as const;

interface NamedChanges {
  readonly identity: SessionIdentity;
  readonly last: RosterDiffSession;
  readonly changes: string[];
}

function identityKey(identity: SessionIdentity): string {
  return JSON.stringify([identity.providerId, identity.providerSessionId]);
}

function sessionSummary(session: Session): WireRecord {
  return {
    provider_name: session.provider.displayName,
    title: session.title,
    status: session.status,
    ...(session.holdingForDeveloper === true ? { holding_for_developer: true } : undefined),
    ...(session.completionCause ? { completion_cause: session.completionCause } : undefined),
    ...(session.workspace?.name ? { workspace: session.workspace.name } : undefined),
    ...(session.detail.error ? { error: session.detail.error } : undefined),
    ...(session.detail.activity ? { activity: session.detail.activity } : undefined),
    ...(session.detail.branch ? { branch: session.detail.branch } : undefined),
    updated_at: new Date(session.lastActivityAt).toISOString(),
  };
}

function vanishedSummary(last: RosterDiffSession): WireRecord {
  return {
    title: last.title,
    status: last.status,
    ...(last.workspaceName ? { workspace: last.workspaceName } : undefined),
  };
}

function lineChange(field: string, from: string | undefined, to: string | undefined): string {
  return `${field}: ${from ?? "none"} → ${to ?? "none"}`;
}

/** One stored diff with the instant of the snapshot it led to, which is the instant its wakes carry. */
export interface DatedRosterDiff {
  readonly diff: RosterDiff;
  readonly observedAt: number;
}

export function wakeEventsFromDiff(
  { diff, observedAt }: DatedRosterDiff,
  roster: HostedRoster,
): BrainWakeEvent[] {
  const named = new Map<string, NamedChanges>();
  const note = (session: RosterDiffSession, change: string) => {
    const identity: SessionIdentity = {
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    };
    const key = identityKey(identity);
    const held = named.get(key) ?? { identity, last: session, changes: [] };
    held.changes.push(change);
    named.set(key, held);
  };
  for (const session of diff.appeared) note(session, SESSION_CHANGE.APPEARED);
  for (const transition of diff.statusChanged) {
    note(transition.session, lineChange("status", transition.from, transition.to));
  }
  for (const change of diff.errorChanged) {
    note(change.session, lineChange("error", change.from, change.to));
  }
  for (const change of diff.activityChanged) {
    note(change.session, lineChange("activity", change.from, change.to));
  }
  for (const session of diff.vanished) note(session, SESSION_CHANGE.VANISHED);

  return [...named.values()].map(({ identity, last, changes }) => {
    const session = roster.sessions.find(
      (candidate) =>
        candidate.providerId === identity.providerId &&
        candidate.providerSessionId === identity.providerSessionId,
    );
    return {
      kind: BRAIN_WAKE_KIND.ROSTER,
      identity,
      atMs: observedAt,
      sessionSummary: {
        ...(session ? sessionSummary(session) : vanishedSummary(last)),
        changes,
      },
    };
  });
}

/** Every pending diff's wakes together, oldest diff first. */
export function wakeEventsFromDiffs(
  diffs: readonly DatedRosterDiff[],
  roster: HostedRoster,
): BrainWakeEvent[] {
  return diffs.flatMap((dated) => wakeEventsFromDiff(dated, roster));
}
