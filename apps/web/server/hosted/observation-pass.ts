import { pbkdf2Sync } from "node:crypto";
import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult } from "effect";
import { type CloudAgentProviderId, isCloudAgentProviderId } from "../core.js";
import { type ActionRoster, actionRosterFor } from "./action-execute.js";
import {
  CLOUD_OBSERVE_FAILURE,
  type CloudObserveFailure,
  type CloudObserveSeams,
  observeCloudProviders,
} from "./cloud-observe.js";
import { decryptProviderKey } from "./encryption.js";
import {
  decodeObservedRoster,
  encodeObservedRoster,
  OBSERVED_ROSTER_VERSION,
  type ObservedRoster,
} from "./observed-roster.js";
import { rosterDiff, rosterDiffIsEmpty } from "./roster-diff.js";
import type { HostedStore, RosterSnapshotRecord } from "./store/index.js";
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

/** What a pass answers: an effect over the ambient client, which the edge that owns the connection runs. */
type ObservationEffect<A> = Effect.Effect<
  A,
  SqlError | ParseResult.ParseError,
  SqlClient.SqlClient
>;

/**
 * A read whose answer is optional however it failed. The payload envelope
 * refuses a body it cannot open by throwing, which is a defect rather than a
 * typed failure, and a snapshot this build cannot open is one the next whole
 * pass replaces rather than one that fails the account's read.
 */
const optionally = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.option(Effect.catchAllDefect(effect, () => Effect.fail(undefined)));

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
 * The snapshot standing for a user: its instant always, and its roster where
 * this build can open and read the body and the body was observed under the
 * key rows standing now. A body it cannot read — sealed under a key the ring
 * no longer holds, or in a shape another build wrote — or one observed under
 * a key since replaced or removed keeps its instant here so the next pass can
 * replace it, and offers no roster to serve or to diff against.
 */
export interface StoredSnapshot {
  readonly observedAt: number;
  readonly roster?: ObservedRoster;
}

/**
 * How a key's fingerprint is derived. The key is a credential, so the
 * derivation is a password one rather than a plain hash: salted with the
 * deployment's secret and stretched, so a fingerprint in a stored snapshot
 * cannot be brute-forced back to the key even with the database in hand.
 * The stretch is kept light because every read of the snapshot derives one
 * fingerprint per key row.
 */
const KEY_FINGERPRINT = {
  ITERATIONS: 10_000,
  LENGTH_BYTES: 32,
  DIGEST: "sha256",
} as const;

/**
 * What identifies the key a provider was observed under: a derivation of the
 * key itself under the deployment's secret. The same key saved again — which
 * the Mac does on every launch, rewriting the stored ciphertext under a fresh
 * nonce — keeps its fingerprint, and a different key has another.
 */
export function keyFingerprint(apiKey: string, secret: string): string {
  return pbkdf2Sync(
    apiKey,
    secret,
    KEY_FINGERPRINT.ITERATIONS,
    KEY_FINGERPRINT.LENGTH_BYTES,
    KEY_FINGERPRINT.DIGEST,
  ).toString("hex");
}

/** The fingerprint of each cloud provider's standing key, by provider; a row this secret cannot open names none. */
function keyFingerprints(
  rows: readonly VaultKeyRow[],
  secret: string,
): Map<CloudAgentProviderId, string> {
  const fingerprints = new Map<CloudAgentProviderId, string>();
  for (const row of rows) {
    if (!isCloudAgentProviderId(row.providerId) || fingerprints.has(row.providerId)) continue;
    try {
      fingerprints.set(
        row.providerId,
        keyFingerprint(decryptProviderKey(row.ciphertext, secret), secret),
      );
    } catch {
      // A key this deployment cannot open observed nothing; the pass reports it as unreadable.
    }
  }
  return fingerprints;
}

/**
 * Whether a snapshot was observed under exactly the keys standing now: the
 * same providers, each under the same key. A snapshot that was not is
 * another key's roster, however recent, and is neither served nor admitted
 * against nor diffed from.
 */
function rosterObservedUnder(
  roster: ObservedRoster,
  rows: readonly VaultKeyRow[],
  secret: string,
): boolean {
  const standing = keyFingerprints(rows, secret);
  if (roster.providers.length !== standing.size) return false;
  return roster.providers.every(
    (provider) => standing.get(provider.providerId) === provider.keyFingerprint,
  );
}

/**
 * The snapshot standing, as far as this build can read it: a body it cannot
 * open is not a failed read but a snapshot with no roster, so the instant
 * alone is answered and the next pass replaces it.
 */
export function storedRoster(
  store: ObservationStore,
  userId: string,
  rows: readonly VaultKeyRow[],
  secret: string,
): Effect.Effect<StoredSnapshot | undefined, never, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const read = yield* optionally(store.roster.read(userId));
    if (Option.isNone(read)) {
      const observedAt = yield* optionally(store.roster.observedAt(userId));
      const instant = Option.getOrUndefined(
        Option.flatten(Option.map(observedAt, Option.fromNullable)),
      );
      return instant === undefined ? undefined : { observedAt: instant };
    }
    const snapshot: RosterSnapshotRecord | undefined = read.value;
    if (!snapshot) return undefined;
    const roster = decodeObservedRoster(snapshot.body);
    return roster && rosterObservedUnder(roster, rows, secret)
      ? { observedAt: snapshot.observedAt, roster }
      : { observedAt: snapshot.observedAt };
  });
}

export function observeAndSnapshot(
  input: ObservationPassInput,
): ObservationEffect<ObservationPassOutcome> {
  return Effect.gen(function* () {
    const { userId, store, now } = input;
    // The attempt is on record before the provider is asked, so a pass that
    // hangs or is cut off with the function still moves this account to the
    // back of the schedule's order and reads as unfinished until a later pass
    // answers for it.
    yield* store.roster.recordPass(userId, {
      attemptedAt: now,
      failure: CLOUD_OBSERVE_FAILURE.UNFINISHED,
    });
    const previous = yield* storedRoster(store, userId, input.rows, input.secret);
    const standing: Pick<ObservationPassOutcome, "roster" | "observedAt"> = {};
    if (previous?.roster) {
      standing.roster = previous.roster;
      standing.observedAt = previous.observedAt;
    }

    const providerIds = keyedCloudProviderIds(input.rows);
    const passes = yield* Effect.promise(() =>
      observeCloudProviders({
        providerIds,
        readApiKey: readApiKeyFor(input.rows, input.secret),
        seams: input.seams,
      }),
    );
    const failed = passes.find((pass) => pass.failure !== undefined);
    if (failed?.failure) {
      yield* store.roster.recordPass(userId, { attemptedAt: now, failure: failed.failure });
      return { complete: false, failure: failed.failure, changed: false, ...standing };
    }

    const fingerprints = keyFingerprints(input.rows, input.secret);
    const roster: ObservedRoster = {
      version: OBSERVED_ROSTER_VERSION,
      providers: passes.map((pass) => ({
        providerId: pass.providerId,
        keyFingerprint: fingerprints.get(pass.providerId) ?? "",
        observations: pass.observations,
        projects: pass.projects,
      })),
    };
    const diff = previous?.roster ? rosterDiff(previous.roster, roster) : undefined;
    const changed = diff !== undefined && !rosterDiffIsEmpty(diff);
    // A roster read whole that could not be written down is a failed pass for
    // this user; the snapshot on record, if any, is whatever stood.
    const advanced = yield* optionally(
      Effect.tap(
        store.roster.advance(
          userId,
          { body: encodeObservedRoster(roster), observedAt: now },
          previous?.observedAt,
        ),
        (landed) => (landed ? store.roster.recordPass(userId, { attemptedAt: now }) : Effect.void),
      ),
    );
    if (Option.isNone(advanced)) {
      yield* optionally(
        store.roster.recordPass(userId, {
          attemptedAt: now,
          failure: CLOUD_OBSERVE_FAILURE.PASS_FAILED,
        }),
      );
      return {
        complete: false,
        failure: CLOUD_OBSERVE_FAILURE.PASS_FAILED,
        changed: false,
        ...standing,
      };
    }
    const landed = advanced.value;
    if (!landed) {
      // Another pass wrote the roster first; its snapshot is the one that
      // stands and the transition it recorded is not recorded again here. This
      // pass still read the roster whole, and a whole roster stands, so the
      // account's record says so at this pass's own instant: the record only
      // moves forward, so an older instant here changes nothing, and a newer
      // one closes the unfinished attempt it opened above.
      yield* store.roster.recordPass(userId, { attemptedAt: now });
      const superseded = yield* storedRoster(store, userId, input.rows, input.secret);
      const outcome: ObservationPassOutcome = { complete: true, changed: false };
      if (superseded?.roster) {
        outcome.roster = superseded.roster;
        outcome.observedAt = superseded.observedAt;
      }
      return outcome;
    }
    return { complete: true, changed, roster, observedAt: now };
  });
}

/**
 * The roster an action is admitted against: the stored snapshot's slice for
 * the provider, or, for a user no pass has reached yet or whose keys have
 * changed since the last one, the pass that seeds the snapshot — run once
 * here so the next action and the next observe read what it stored rather
 * than asking the provider again.
 */
export function rosterForAction(input: {
  userId: string;
  providerId: CloudAgentProviderId;
  secret: string;
  store: ObservationStore;
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  seams: CloudObserveSeams;
  now: number;
}): ObservationEffect<ActionRoster> {
  return Effect.gen(function* () {
    const rows = yield* Effect.promise(() => input.readVaultKeys(input.userId));
    const stored = yield* storedRoster(input.store, input.userId, rows, input.secret);
    if (stored?.roster) return actionRosterFor(input.providerId, { roster: stored.roster });
    const outcome = yield* observeAndSnapshot({
      userId: input.userId,
      rows,
      secret: input.secret,
      store: input.store,
      seams: input.seams,
      now: input.now,
    });
    return actionRosterFor(input.providerId, outcome);
  });
}
