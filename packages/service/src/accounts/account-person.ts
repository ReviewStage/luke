import { Database, type DatabaseServices, type QueryError } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { pinnedPictureUrl } from "@repo/features/account-picture";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

export interface AccountPerson {
  readonly name: string;
  readonly email: string;
}

const PersonRowSchema = Schema.Struct({ name: Schema.String, email: Schema.String });

const findPerson = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PersonRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
    ),
});

export function readAccountPerson(
  userId: string,
): Effect.Effect<AccountPerson | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findPerson(userId), Option.getOrUndefined);
}

const PictureRowSchema = Schema.Struct({ image: Schema.NullOr(Schema.String) });

const findPicture = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PictureRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db.select({ image: user.image }).from(user).where(eq(user.id, userId)).limit(1),
    ),
});

export function readAccountPicture(
  userId: string,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findPicture(userId), (row) =>
    pinnedPictureUrl(Option.getOrUndefined(row)?.image),
  );
}
