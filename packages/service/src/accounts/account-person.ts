/**
 * account-person.ts -- who an account is, read from its own user row.
 *
 * The service reads an account's name and email from the row the sign-in
 * keeps for it rather than from any request, so the desktop sends nothing
 * that names anybody: the events endpoint's PostHog person fields read it
 * here, and so does choosing which integrations the account is offered
 * (`integration-connect.ts`). An invitation email reads its inviter's
 * sign-in picture here too.
 */

import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { pinnedPictureUrl } from "@luke/features/account-picture";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

/** The account's own name and email, as its user row holds them. */
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

/** The account's name and email, or nothing for an id no user row holds. */
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

/** The account's sign-in picture, where it is one a renderer may draw (`account-picture.ts`); nothing otherwise. */
export function readAccountPicture(
  userId: string,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findPicture(userId), (row) =>
    pinnedPictureUrl(Option.getOrUndefined(row)?.image),
  );
}
