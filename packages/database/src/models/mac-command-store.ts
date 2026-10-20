import {
  isMacBrowserResult,
  MAC_COMMAND_IMAGE_TYPE,
  MAC_COMMAND_KIND,
  type MacBrowserResult,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
  macCommandResultSchema,
} from "@luke/features/mac-command-wire";
import { and, asc, eq, gte, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { macCommand, macCommandListener, macCommandListenerKind } from "../schemas/mac-command.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * mac-command-store.ts -- the commands an account's agents queued for its Mac, and when a Mac last listened for each kind of them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account claims, settles, or reads another's commands. A
 * command is claimed once, by the first Mac whose read names its kind and
 * takes it, and settled once, by a Mac after it was claimed; the call that
 * queued it reads the result and withdraws the row. A browser command's
 * image is kept as bytes beside its JSON result, never in it, and read
 * back with it once, as the result is found.
 */

const CommandKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const KindSchema = Schema.Literals(Object.values(MAC_COMMAND_KIND));

const KindsSchema = Schema.Array(KindSchema);

const ImageTypeSchema = Schema.Literals(Object.values(MAC_COMMAND_IMAGE_TYPE));

/** An image's bytes as the wire spells them, base64, and as the column keeps them, raw. */
const ImageBytesSchema = Schema.flip(Schema.Uint8ArrayFromBase64);

/**
 * A claimed row as the Mac is handed it, by its kind: a shell command's
 * text, or another kind's params. Note that the column the other kind
 * leaves null is read past, as every key a struct does not name is.
 */
const ClaimedSchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal(MAC_COMMAND_KIND.SHELL),
    command: Schema.String,
    timeoutSeconds: Schema.Number,
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal(MAC_COMMAND_KIND.BROWSER),
    params: Schema.Json,
    timeoutSeconds: Schema.Number,
  }),
]);

const upsertListener = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .insert(macCommandListener)
        .values({ userId, seenAt: now })
        .onConflictDoUpdate({ target: macCommandListener.userId, set: { seenAt: now } }),
    ),
});

const upsertListenerKind = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, kind: KindSchema, now: Schema.Date }),
  execute: ({ userId, kind, now }) =>
    Database.use((db) =>
      db
        .insert(macCommandListenerKind)
        .values({ userId, kind, seenAt: now })
        .onConflictDoUpdate({
          target: [macCommandListenerKind.userId, macCommandListenerKind.kind],
          set: { seenAt: now },
        }),
    ),
});

const findListenerKind = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, kind: KindSchema, since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, kind, since }) =>
    Database.use((db) =>
      db
        .select({ userId: macCommandListenerKind.userId })
        .from(macCommandListenerKind)
        .where(
          and(
            eq(macCommandListenerKind.userId, userId),
            eq(macCommandListenerKind.kind, kind),
            gte(macCommandListenerKind.seenAt, since),
          ),
        ),
    ),
});

const findListener = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .select({ userId: macCommandListener.userId })
        .from(macCommandListener)
        .where(and(eq(macCommandListener.userId, userId), gte(macCommandListener.seenAt, since))),
    ),
});

const insertCommand = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    kind: KindSchema,
    command: Schema.NullOr(Schema.String),
    params: Schema.NullOr(Schema.Json),
    timeoutSeconds: Schema.Number,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(macCommand).values({
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        command: row.command,
        params: row.params,
        timeoutSeconds: row.timeoutSeconds,
        queuedAt: row.now,
      }),
    ),
});

/**
 * Whether a command still waits to be claimed by a read naming the kinds
 * given: of one of them, unclaimed, and queued at or after the instant
 * given, so a command no Mac took in time, or a row a call that died left
 * behind, is never run by a Mac that reads later, and a Mac is never
 * handed a kind it did not name.
 */
function waiting(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): SQL | undefined {
  return and(
    eq(macCommand.userId, userId),
    inArray(macCommand.kind, kinds),
    isNull(macCommand.claimedAt),
    gte(macCommand.queuedAt, queuedSince),
  );
}

const claimWaiting = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
    now: Schema.Date,
  }),
  Result: ClaimedSchema,
  execute: ({ userId, queuedSince, kinds, now }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ claimedAt: now })
        .where(waiting(userId, queuedSince, kinds))
        .returning({
          id: macCommand.id,
          kind: macCommand.kind,
          command: macCommand.command,
          params: macCommand.params,
          timeoutSeconds: macCommand.timeoutSeconds,
        }),
    ),
});

const findWaiting = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, queuedSince: Schema.Date, kinds: KindsSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, queuedSince, kinds }) =>
    Database.use((db) =>
      db
        .select({ id: macCommand.id })
        .from(macCommand)
        .where(waiting(userId, queuedSince, kinds))
        .orderBy(asc(macCommand.queuedAt)),
    ),
});

const writeResult = SqlSchema.findAll({
  Request: Schema.Struct({ ...CommandKeySchema.fields, result: macCommandResultSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, result }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({ result })
        .where(
          and(
            eq(macCommand.id, id),
            eq(macCommand.userId, userId),
            isNotNull(macCommand.claimedAt),
            isNull(macCommand.result),
          ),
        )
        .returning({ id: macCommand.id }),
    ),
});

const writeBrowserResult = SqlSchema.findAll({
  Request: Schema.Struct({
    ...CommandKeySchema.fields,
    output: Schema.Json,
    image: Schema.NullOr(Schema.Struct({ mediaType: ImageTypeSchema, data: ImageBytesSchema })),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, output, image }) =>
    Database.use((db) =>
      db
        .update(macCommand)
        .set({
          result: { output },
          resultImage: image?.data ?? null,
          resultImageType: image?.mediaType ?? null,
        })
        .where(
          and(
            eq(macCommand.id, id),
            eq(macCommand.userId, userId),
            eq(macCommand.kind, MAC_COMMAND_KIND.BROWSER),
            isNotNull(macCommand.claimedAt),
            isNull(macCommand.result),
          ),
        )
        .returning({ id: macCommand.id }),
    ),
});

const findResult = SqlSchema.findOneOption({
  Request: CommandKeySchema,
  Result: Schema.Struct({
    result: macCommandResultSchema,
    image: Schema.NullOr(ImageBytesSchema),
    imageType: Schema.NullOr(ImageTypeSchema),
  }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({
          result: macCommand.result,
          image: macCommand.resultImage,
          imageType: macCommand.resultImageType,
        })
        .from(macCommand)
        .where(
          and(eq(macCommand.id, id), eq(macCommand.userId, userId), isNotNull(macCommand.result)),
        ),
    ),
});

const deleteCommand = SqlSchema.void({
  Request: CommandKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db.delete(macCommand).where(and(eq(macCommand.id, id), eq(macCommand.userId, userId))),
    ),
});

/**
 * Records that a Mac of the account is listening now, for shell commands,
 * which every Mac runs, and for each other kind it named.
 */
export function markMacListening(
  userId: string,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.andThen(
      upsertListener({ userId, now }),
      Effect.forEach(
        kinds.filter((kind) => kind !== MAC_COMMAND_KIND.SHELL),
        (kind) => upsertListenerKind({ userId, kind, now }),
        { discard: true },
      ),
    ),
  );
}

/** Whether a Mac of the account that runs the kind given listened at or after the instant given. */
export function macListeningSince(
  userId: string,
  kind: MacCommandKind,
  since: Date,
): TaskStoreEffect<boolean> {
  const found =
    kind === MAC_COMMAND_KIND.SHELL
      ? findListener({ userId, since })
      : findListenerKind({ userId, kind, since });
  return Effect.map(found, Option.isSome);
}

/** Queues one command for the account's Mac, under the id its caller minted. */
export function queueMacCommand(userId: string, queued: MacCommand): TaskStoreEffect<void> {
  const carried =
    queued.kind === MAC_COMMAND_KIND.SHELL
      ? { command: queued.command, params: null }
      : { command: null, params: queued.params };
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    insertCommand({
      id: queued.id,
      userId,
      kind: queued.kind,
      ...carried,
      timeoutSeconds: queued.timeoutSeconds,
      now,
    }),
  );
}

/**
 * Whether any command of the account, of the kinds given, queued at or
 * after `queuedSince` waits to be claimed, which is what a held read looks at.
 */
export function macCommandsWaiting(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<boolean> {
  return Effect.map(findWaiting({ userId, queuedSince, kinds }), (rows) => rows.length > 0);
}

/**
 * Claims every command of the account, of the kinds given, queued at or
 * after `queuedSince` that waits, for the Mac whose read this is.
 */
export function claimMacCommands(
  userId: string,
  queuedSince: Date,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<readonly MacCommand[]> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    claimWaiting({ userId, queuedSince, kinds, now }),
  );
}

/** Keeps a claimed command's result; false where the account holds no such command claimed and unsettled. */
export function settleMacCommand(
  userId: string,
  id: string,
  result: MacCommandResult,
): TaskStoreEffect<boolean> {
  return Effect.map(writeResult({ userId, id, result }), (rows) => rows.length > 0);
}

/**
 * Keeps a claimed browser command's result, its image as bytes beside the
 * JSON; false where the account holds no such browser command claimed and
 * unsettled, so an image never lands on a command of another kind.
 */
export function settleMacBrowserResult(
  userId: string,
  id: string,
  result: MacBrowserResult,
): TaskStoreEffect<boolean> {
  const written = writeBrowserResult({
    userId,
    id,
    output: result.output,
    image: result.image ?? null,
  });
  return Effect.map(written, (rows) => rows.length > 0);
}

/** A command's result once a Mac settled it, a browser command's image with it; nothing while it waits or runs. */
export function macCommandResult(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<MacCommandResult>> {
  return Effect.map(
    findResult({ userId, id }),
    Option.map(({ result, image, imageType }): MacCommandResult => {
      if (image === null || imageType === null || !isMacBrowserResult(result)) return result;
      return { ...result, image: { mediaType: imageType, data: image } };
    }),
  );
}

/** Withdraws a command, settled or not, once its call stops waiting on it. */
export function withdrawMacCommand(userId: string, id: string): TaskStoreEffect<void> {
  return deleteCommand({ userId, id });
}
