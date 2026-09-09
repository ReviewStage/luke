import { randomUUID } from "node:crypto";
import { type CloudAgentProviderId, isCloudAgentProviderId } from "../core.js";
import { type ActionRoster, actionRosterFor } from "./action-execute.js";
import {
  CLOUD_OBSERVE_FAILURE,
  type CloudObserveFailure,
  type CloudObserveSeams,
  observeCloudProviders,
} from "./cloud-observe.js";
import {
  decodeObservedRoster,
  encodeObservedRoster,
  OBSERVED_ROSTER_VERSION,
  type ObservedRoster,
} from "./observed-roster.js";
import { encodeRosterDiff, rosterDiff, rosterDiffIsEmpty } from "./roster-diff.js";
import type { HostedStore } from "./store/index.js";
import { readApiKeyFor } from "./vault-keys.js";
import type { VaultKeyRow } from "./vault-route.js";

/**
 * One observation pass over a user's cloud providers, written down: the
 * roster read whole replaces the stored snapshot and the diff against the
 * snapshot it replaced is recorded for the brain host to consume; a pass any
 * provider could not read whole leaves the previous snapshot standing and is
 * recorded as failed for that user, never as a partial roster. The same pass
 * runs from the scheduled tick, from an observe request that asked for a
 * fresh read or found no snapshot yet, and from an action for a user with no
 * snapshot, so every path stores the roster one way.
 */

/** The slice of the store an observation pass reaches. */
export type ObservationStore = Pick<HostedStore, "roster">;

export interface ObservationPassInput {
  userId: string;
  rows: readonly VaultKeyRow[];
  secret: string;
  store: ObservationStore;
  seams: CloudObserveSeams;
  now: number;
}

export interface ObservationPassOutcome {
  /** Whether every provider's roster was read whole and the snapshot moved. */
  complete: boolean;
  failure?: CloudObserveFailure;
  /** Whether the pass found the roster changed against the snapshot it replaced. */
  changed: boolean;
  /** The snapshot standing after the pass: the new one, or the previous one a failed pass left, or none. */
  roster?: ObservedRoster;
  observedAt?: number;
}

/** The cloud providers a user's stored keys open. */
export function keyedCloudProviderIds(rows: readonly VaultKeyRow[]): CloudAgentProviderId[] {
  return [...new Set(rows.map((row) => row.providerId).filter((id) => isCloudAgentProviderId(id)))];
}

/**
 * The stored snapshot as a roster, or nothing where none stands or the body
 * is one this build cannot read; an unreadable body reads as no snapshot,
 * so the next pass writes a fresh one and diffs against nothing.
 */
export async function storedRoster(
  store: ObservationStore,
  userId: string,
): Promise<{ roster: ObservedRoster; observedAt: number } | undefined> {
  let snapshot: Awaited<ReturnType<ObservationStore["roster"]["read"]>>;
  try {
    snapshot = await store.roster.read(userId);
  } catch {
    return undefined;
  }
  if (!snapshot) return undefined;
  const roster = decodeObservedRoster(snapshot.body);
  return roster ? { roster, observedAt: snapshot.observedAt } : undefined;
}

export async function observeAndSnapshot(
  input: ObservationPassInput,
): Promise<ObservationPassOutcome> {
  const { userId, store, now } = input;
  // The attempt is on record before the provider is asked, so a pass that
  // hangs or is cut off with the function still moves this account to the
  // back of the schedule's order and reads as unfinished until a later pass
  // answers for it.
  await store.roster.recordPass(userId, {
    attemptedAt: now,
    failure: CLOUD_OBSERVE_FAILURE.UNFINISHED,
  });
  const previous = await storedRoster(store, userId);
  const standing = previous ? { roster: previous.roster, observedAt: previous.observedAt } : {};

  const providerIds = keyedCloudProviderIds(input.rows);
  const passes = await observeCloudProviders({
    providerIds,
    readApiKey: readApiKeyFor(input.rows, input.secret),
    seams: input.seams,
  });
  const failed = passes.find((pass) => pass.failure !== undefined);
  if (failed?.failure) {
    await store.roster.recordPass(userId, { attemptedAt: now, failure: failed.failure });
    return { complete: false, failure: failed.failure, changed: false, ...standing };
  }

  const roster: ObservedRoster = {
    version: OBSERVED_ROSTER_VERSION,
    providers: passes.map((pass) => ({
      providerId: pass.providerId,
      observations: pass.observations,
      projects: pass.projects,
    })),
  };
  const diff = previous ? rosterDiff(previous.roster, roster) : undefined;
  const changed = diff !== undefined && !rosterDiffIsEmpty(diff);
  let landed: boolean;
  try {
    landed = await store.roster.advance(
      userId,
      { body: encodeObservedRoster(roster), observedAt: now },
      changed && diff && previous
        ? {
            id: randomUUID(),
            observedAt: now,
            previousObservedAt: previous.observedAt,
            payload: encodeRosterDiff(diff),
          }
        : undefined,
      previous?.observedAt,
    );
    await store.roster.recordPass(userId, { attemptedAt: now });
  } catch {
    // A roster read whole that could not be written down is a failed pass
    // for this user; the snapshot on record, if any, is whatever stood.
    await store.roster
      .recordPass(userId, { attemptedAt: now, failure: CLOUD_OBSERVE_FAILURE.PASS_FAILED })
      .catch(() => undefined);
    return {
      complete: false,
      failure: CLOUD_OBSERVE_FAILURE.PASS_FAILED,
      changed: false,
      ...standing,
    };
  }
  if (!landed) {
    // Another pass wrote the roster first; its snapshot is the one that
    // stands, and the transition it recorded is not recorded again here.
    const superseded = await storedRoster(store, userId);
    return { complete: true, changed: false, ...(superseded ?? {}) };
  }
  return { complete: true, changed, roster, observedAt: now };
}

/**
 * The roster an action is admitted against: the stored snapshot's slice for
 * the provider, or, for a user no pass has reached yet, the pass that seeds
 * the snapshot — run once here so the next action and the next observe read
 * what it stored rather than asking the provider again.
 */
export async function rosterForAction(input: {
  userId: string;
  providerId: CloudAgentProviderId;
  secret: string;
  store: ObservationStore;
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  seams: CloudObserveSeams;
  now: number;
}): Promise<ActionRoster> {
  const stored = await storedRoster(input.store, input.userId);
  if (stored) return actionRosterFor(input.providerId, { roster: stored.roster });
  const outcome = await observeAndSnapshot({
    userId: input.userId,
    rows: await input.readVaultKeys(input.userId),
    secret: input.secret,
    store: input.store,
    seams: input.seams,
    now: input.now,
  });
  return actionRosterFor(input.providerId, outcome);
}
