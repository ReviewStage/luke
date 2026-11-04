/**
 * host-store.ts -- an account's machines enrolled with a device secret: an own device enrolled, resolved by a device secret, listed, and removed.
 *
 * Every function is an effect over the ambient `SqlClient`. Secrets arrive
 * here as their SHA-256 alone (the service mints them and hashes them), so
 * nothing here ever holds one. Every read and write the account names is
 * keyed by it, so no account lists, removes, or enrolls another's; the
 * secret read is keyed by the secret's hash alone, which names one standing
 * machine (`../schemas/device.ts`).
 *
 * A machine is enrolled where its row holds a secret and was not removed,
 * whatever its kind or platform: a box its approved pairing
 * keyed (`./host-pairing-store.ts`), and a member's own desktop converted in
 * place by its signed-in session (`enrollOwnDevice`), or created by it where
 * the account never registered the id, are read, listed, refused below the
 * floor, and removed alike. A host a pairing's approve made is listed and
 * removed as one from its approve, before its box collects its secret
 * (`listed`).
 *
 * One Mac stands as one host. A Mac that joins again, after a reinstall,
 * a lost record, or a second sign-in's enroll, folds the account's other
 * listed Macs on the same machine into its own row (`folded`): their
 * agents, the tasks that run on them, and the account's Runs on pick move
 * to it, their open launches are settled, and they are removed as
 * Settings' Remove removes a host, in the join's own transaction. Only an
 * own enroll and a host's first register fold, never a later register, so
 * two hosts already running never remove each other; the account's joins
 * take one lock, so two at once land one after another; and only Macs
 * fold, since a Linux image may ship one baked machine id to many boxes.
 */

import {
  DEVICE_ARCH,
  DEVICE_KIND,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DeviceMachine,
  type DevicePlatform,
  deviceSetupSchema,
  hostUpdateSchema,
} from "@repo/features/device-agent-wire";
import { and, asc, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { device } from "../schemas/device.js";
import { hostPairing } from "../schemas/host-pairing.js";
import { accountPreference } from "../schemas/preferences.js";
import { task } from "../schemas/task.js";
import { runningTurnIds } from "./abandoned-turns.js";
import { settleGoneDeviceAgentLaunches } from "./device-agent-store.js";
import {
  type DeviceRegistration,
  MachineColumnsSchema,
  machineColumns,
  registerDevice,
} from "./device-store.js";

type HostEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** The device a host's secret names, its account, and the daemon version it last called with. */
const HostCallerSchema = Schema.Struct({
  deviceId: Schema.String,
  userId: Schema.String,
  version: Schema.NullOr(Schema.String),
});

export type HostCaller = typeof HostCallerSchema.Type;

/** One of the account's enrolled machines, as Settings lists it: beside its name and beat, which machine it runs on and its model, none where its host never said, its home folder, none before it first registered, where its setup stands and why it failed, none once it is ready, and where its update stands and why it failed, as its last beat said, none while no update is under way. */
const HostRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
  machineId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.Date,
  version: Schema.NullOr(Schema.String),
  home: Schema.NullOr(Schema.String),
  setup: Schema.NullOr(deviceSetupSchema),
  setupFailure: Schema.NullOr(Schema.String),
  update: Schema.NullOr(hostUpdateSchema),
  updateFailure: Schema.NullOr(Schema.String),
});

export type HostRow = typeof HostRowSchema.Type;

const KeptSchema = Schema.Struct({ id: Schema.String });

/**
 * Whether a device row is one of the account's hosts as Settings lists and
 * removes them: enrolled, or made by a pairing's approve and not removed
 * while its box has yet to collect its secret (`./host-pairing-store.ts`).
 */
function listed() {
  return and(
    isNull(device.removedAt),
    or(
      isNotNull(device.secretHash),
      exists(
        queryBuilder
          .select({ id: hostPairing.id })
          .from(hostPairing)
          .where(eq(hostPairing.deviceId, device.id)),
      ),
    ),
  );
}

/**
 * The account's own device keyed with a new secret, inserted where no row
 * holds the id, so a machine whose first word to the service is its enroll is
 * created under the account.
 */
const insertOwnDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    name: Schema.String,
    platform: Schema.Literals(Object.values(DEVICE_PLATFORM)),
    arch: Schema.Literals(Object.values(DEVICE_ARCH)),
    ...MachineColumnsSchema.fields,
    version: Schema.String,
    secretHash: Schema.String,
    now: Schema.Date,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, name, platform, arch, machineId, model, version, secretHash, now }) =>
    Database.use((db) =>
      db
        .insert(device)
        .values({
          id,
          userId,
          name,
          kind: DEVICE_KIND.HOST,
          platform,
          arch,
          ...machineColumns({ machineId, model }),
          version,
          secretHash,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: device.id,
          set: {
            kind: DEVICE_KIND.HOST,
            ...machineColumns({ machineId, model }),
            version,
            secretHash,
            removedAt: null,
          },
          // Note that another account's device is never keyed, so its id answers no row, as an id the account never registered once did.
          setWhere: sql`${device.userId} = ${userId}`,
        })
        .returning({ id: device.id }),
    ),
});

/** The account's own device keyed with a new secret in place, under the same id, so its agents keep it. */
const keyOwnDevice = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    ...MachineColumnsSchema.fields,
    version: Schema.String,
    secretHash: Schema.String,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, machineId, model, version, secretHash }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({
          kind: DEVICE_KIND.HOST,
          ...machineColumns({ machineId, model }),
          version,
          secretHash,
          removedAt: null,
        })
        .where(and(eq(device.id, id), eq(device.userId, userId)))
        .returning({ id: device.id }),
    ),
});

const findHostAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ userId, deviceId }) =>
    Database.use((db) =>
      db
        .select({ conversationId: agentTable.conversationId })
        .from(agentTable)
        .where(and(eq(agentTable.userId, userId), eq(agentTable.deviceId, deviceId))),
    ),
});

const findRemoved = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: KeptSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.id, id), eq(device.userId, userId), isNotNull(device.removedAt))),
    ),
});

const findBySecret = SqlSchema.findOneOption({
  Request: Schema.Struct({ secretHash: Schema.String }),
  Result: HostCallerSchema,
  execute: ({ secretHash }) =>
    Database.use((db) =>
      db
        .select({ deviceId: device.id, userId: device.userId, version: device.version })
        .from(device)
        .where(and(eq(device.secretHash, secretHash), isNull(device.removedAt))),
    ),
});

const writeVersion = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, version: Schema.String }),
  execute: ({ id, version }) =>
    Database.use((db) => db.update(device).set({ version }).where(eq(device.id, id))),
});

const findHosts = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: HostRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          lastSeenAt: device.lastSeenAt,
          version: device.version,
          home: device.home,
          setup: device.setup,
          setupFailure: device.setupFailure,
          update: device.updatePhase,
          updateFailure: device.updateFailure,
        })
        .from(device)
        .where(and(eq(device.userId, userId), listed()))
        .orderBy(asc(device.name), asc(device.id)),
    ),
});

/**
 * The account's listed machine of the id removed, answering the transaction
 * it was removed in, read in its own `RETURNING`, so a reader following the
 * hosts waits for that transaction to arrive before it confirms the remove.
 */
const stampRemoved = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ txid: Schema.String }),
  execute: ({ userId, id, now }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ removedAt: now, secretHash: null })
        .where(and(eq(device.id, id), eq(device.userId, userId), listed()))
        .returning({ txid: sql<string>`pg_current_xact_id()::text` }),
    ),
});

/** The account's device of the id, where its host never registered: a register always writes its home, and nothing else does. */
const findUnregistered = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: KeptSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.id, id), eq(device.userId, userId), isNull(device.home))),
    ),
});

/** The machine the account's standing Mac of the id runs on; nothing for a Linux box, and for a Mac whose host never said. */
const findMacMachine = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ machineId: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ machineId: device.machineId })
        .from(device)
        .where(
          and(
            eq(device.id, id),
            eq(device.userId, userId),
            eq(device.platform, DEVICE_PLATFORM.DARWIN),
            isNotNull(device.machineId),
            isNull(device.removedAt),
          ),
        ),
    ),
});

/** The account's other listed Macs on the machine, removed as `stampRemoved` removes one; their ids. */
const stampFolded = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    machineId: Schema.String,
    now: Schema.Date,
  }),
  Result: KeptSchema,
  execute: ({ userId, id, machineId, now }) =>
    Database.use((db) =>
      db
        .update(device)
        .set({ removedAt: now, secretHash: null })
        .where(
          and(
            eq(device.userId, userId),
            eq(device.machineId, machineId),
            eq(device.platform, DEVICE_PLATFORM.DARWIN),
            ne(device.id, id),
            listed(),
          ),
        )
        .returning({ id: device.id }),
    ),
});

const FoldSchema = Schema.Struct({
  userId: Schema.String,
  from: Schema.Array(Schema.String),
  to: Schema.String,
});

/**
 * The account's agents pinned to the devices folded, pinned to the one they
 * fold into, each runner's bearer retired as the lease sweep retires a gone
 * runner's, since any runner one was handed ran on a device folded; their
 * conversations.
 */
const moveAgents = SqlSchema.findAll({
  Request: FoldSchema,
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ userId, from, to }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ deviceId: to, runnerTokenHash: null })
        .where(and(eq(agentTable.userId, userId), inArray(agentTable.deviceId, [...from])))
        .returning({ conversationId: agentTable.conversationId }),
    ),
});

/**
 * The tasks that run on the devices folded, run on the one they fold into.
 * Note that a task is read by its device alone, whoever made it, because
 * the devices are the account's own and a task names a device only of the
 * member who set it.
 */
const moveTasks = SqlSchema.void({
  Request: FoldSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ deviceId: to })
        .where(inArray(task.deviceId, [...from])),
    ),
});

/** The account's Runs on pick, where it names a device folded, naming the one they fold into. */
const movePick = SqlSchema.void({
  Request: FoldSchema,
  execute: ({ userId, from, to }) =>
    Database.use((db) =>
      db
        .update(accountPreference)
        .set({ runsOnDeviceId: to })
        .where(
          and(
            eq(accountPreference.userId, userId),
            inArray(accountPreference.runsOnDeviceId, [...from]),
          ),
        ),
    ),
});

/** One agent a fold moved: its conversation, and the turns it had running as it moved, which the removed host's runner can no longer end. */
export interface FoldedAgent {
  readonly conversationId: string;
  readonly runningTurnIds: readonly string[];
}

/**
 * Folds the account's other listed Macs on the machine its standing Mac of
 * the id runs on into that Mac, on the transaction its caller holds: their
 * agents, the tasks that run on them, and the account's Runs on pick move
 * to it, the launches still open on them are settled and their agents'
 * runner bearers retired as their runner gone, so a moved agent launches
 * again on the Mac rather than reading a runner there as live, and a runner
 * left on a folded device reaches none of its tools, and they are removed as `removeHost` removes one, their
 * secret refused from now on. Never the Mac itself, so one enrolled again
 * under its own id keeps its row, and never another account's device.
 * Answers each agent moved, with the turns it had running; none where the
 * device is no standing Mac of the account's, its host never said which
 * machine it is, or no other host stands on it.
 */
const folded = (userId: string, id: string) =>
  Effect.gen(function* () {
    const machine = yield* findMacMachine({ userId, id });
    if (Option.isNone(machine)) return [];
    const now = yield* DateTime.nowAsDate;
    const { machineId } = machine.value;
    const removed = yield* stampFolded({ userId, id, machineId, now });
    if (removed.length === 0) return [];
    const fold = { userId, from: removed.map((row) => row.id), to: id };
    const moved = yield* moveAgents(fold);
    yield* moveTasks(fold);
    yield* movePick(fold);
    yield* settleGoneDeviceAgentLaunches(userId, fold.from);
    // Note that the running turns are read before the fold commits, so a turn the device begins once it does is never among them.
    return yield* Effect.forEach(moved, ({ conversationId }) =>
      Effect.map(runningTurnIds(conversationId), (ids) => ({
        conversationId,
        runningTurnIds: ids,
      })),
    );
  });

/**
 * The effect given, in one transaction holding the account's lock on its
 * hosts' joins, so two joins of the account's land one after another and
 * the later folds the earlier, never each the other: two folds that each
 * spare only their own row would otherwise each remove the other's and
 * leave the machine none.
 */
function underJoinLock<A>(userId: string, work: HostEffect<A>): HostEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client`select pg_advisory_xact_lock(hashtextextended(${userId}, 3))`;
        return yield* work;
      }),
    ),
  );
}

/** What a signed-in session enrolls its own machine with: its id, its daemon's version, its new secret's hash, which machine it is where it read it, and the machine as it names itself, which creates the device where the account never registered the id. */
export interface OwnEnrollment extends DeviceMachine {
  readonly id: string;
  readonly version: string;
  readonly secretHash: string;
  readonly machine?: {
    readonly name: string;
    readonly platform: DevicePlatform;
    readonly arch: DeviceArch;
  };
}

/**
 * Enrolls one of the account's own machines with a new secret, on its
 * signed-in session: a row it already has converted in place under the
 * same id, so every agent pinned to it keeps it, and where no row holds
 * the id and the enroll names the machine, a device created under the
 * account with the machine's name, platform and architecture, which its
 * host program's first register fills in. Either is keyed with the new
 * secret's hash and the version it enrolled with, and given which machine
 * it is where the enroll named it (`machineColumns`). A machine already
 * enrolled is keyed again, its old secret refused from now on, and a
 * removed one brought back, since the session holds the account's whole
 * say over its devices; when to ask is its caller's. The enrolled Mac then
 * folds the account's other Macs on its machine into it (`folded`), in the
 * same transaction under the account's join lock (`underJoinLock`). Answers
 * the agents the fold moved; nothing where the id is another account's
 * device, or no row holds it and the enroll named no machine, and nothing
 * was written.
 */
export function enrollOwnDevice(
  userId: string,
  enrollment: OwnEnrollment,
): HostEffect<Option.Option<readonly FoldedAgent[]>> {
  const { machine, ...key } = enrollment;
  return underJoinLock(
    userId,
    Effect.gen(function* () {
      const kept =
        machine === undefined
          ? yield* keyOwnDevice({ userId, ...key })
          : yield* insertOwnDevice({ userId, ...key, ...machine, now: yield* DateTime.nowAsDate });
      if (kept.length === 0) return Option.none();
      return Option.some(yield* folded(userId, enrollment.id));
    }),
  );
}

/**
 * Registers the account's host as `registerDevice` does, and where this is
 * its first register, folds the account's other Macs on its machine into
 * it (`folded`), in one transaction under the account's join lock
 * (`underJoinLock`), so a register the fold failed under is a first
 * register still when it is asked again. Note that only the first folds,
 * a paired box's first word naming its machine, because a later one comes
 * from a host already running, and two such on one machine must never
 * remove each other. Answers the agents the fold
 * moved; nothing where another account holds the id, and nothing was
 * written.
 */
export function registerHost(
  userId: string,
  registered: { readonly id: string; readonly name: string } & DeviceRegistration,
): HostEffect<Option.Option<readonly FoldedAgent[]>> {
  return underJoinLock(
    userId,
    Effect.gen(function* () {
      const joining = (yield* findUnregistered({ userId, id: registered.id })).length > 0;
      if (!(yield* registerDevice(userId, registered))) return Option.none();
      return Option.some(joining ? yield* folded(userId, registered.id) : []);
    }),
  );
}

/** The standing machine a device secret's hash names, of any kind, its account, and the version it last called with; nothing for a removed machine, an old secret, or none. */
export function hostBySecret(secretHash: string): HostEffect<Option.Option<HostCaller>> {
  return findBySecret({ secretHash });
}

/** Records the daemon version the host called with. */
export function recordHostVersion(id: string, version: string): HostEffect<void> {
  return writeVersion({ id, version });
}

/** The account's enrolled machines, of every kind and platform, and the hosts its approves made whose boxes have yet to collect their secret, by name. */
export function hostsOf(userId: string): HostEffect<readonly HostRow[]> {
  return findHosts({ userId });
}

/** Removes the account's enrolled machine, or a host its approve made, and refuses its secret from now on, answering the transaction it was removed in; none where the account lists no such machine. */
export function removeHost(userId: string, id: string): HostEffect<string | undefined> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(stampRemoved({ userId, id, now }), ([removed]) => removed?.txid),
  );
}

/**
 * The account's hosts as Settings › Hosts follows them over Neon Realtime
 * (`hostsLive`): each one's id, name, platform, machine and model, where its
 * host reported them, and where its update stands, under the keys the wire
 * reads them by (`@repo/features/host-live`), by name and then id. Note that
 * a version stands for `listed()` here, which a statement Realtime follows
 * cannot carry, since it reads `host_pairing`: a register never writes a
 * version, an enroll writes it beside the secret, a pairing's approve
 * inserts the row with the box's (`./host-pairing-store.ts`), a removal
 * stamps `removed_at`, and the sweep deletes an approved host that never
 * collected its secret. The secret's hash is never selected, since what a
 * statement selects is what leaves. None where a statement names a value
 * Realtime cannot carry.
 */
export function hostsLiveStatement(userId: string): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          id: device.id,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          update: device.updatePhase,
        }),
      )
      .from(device)
      .where(and(eq(device.userId, userId), isNull(device.removedAt), isNotNull(device.version)))
      .orderBy(asc(device.name), asc(device.id)),
  );
}

/** The conversations of the account's agents pinned to its device, whose runners a removed host can no longer settle. */
export function hostAgentConversations(
  userId: string,
  deviceId: string,
): HostEffect<readonly string[]> {
  return Effect.map(findHostAgents({ userId, deviceId }), (rows) =>
    rows.map((row) => row.conversationId),
  );
}

/** Whether the account removed its machine of the id given, so an agent pinned to it is refused by name rather than as unavailable. */
export function hostRemoved(userId: string, id: string): HostEffect<boolean> {
  return Effect.map(findRemoved({ userId, id }), (rows) => rows.length > 0);
}
