import { and, eq, ne, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import * as SqlClient from "effect/sql/SqlClient";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { member, organization } from "../schemas/auth.js";
import { workspaceFormerSlug } from "../schemas/workspace-former-slug.js";

/**
 * workspace-slug-store.ts -- a workspace's slug changed by its owner, and the slugs it stood under before, which stay its own.
 *
 * A link's first step is its workspace's slug, so a slug the owner moves
 * away from is kept as the workspace's former slug: a reader that finds no
 * workspace under a link's slug finds the one that stood under it before
 * (`workspace-wire.ts`'s `workspaceOfSlug`), and no other workspace ever
 * takes it, made (`workspace-store.ts`'s minting) or changed here; a
 * reader on the service asks `workspaceIdOfSlug`, the same reading. The
 * workspace itself takes a former slug back, which leaves the row. Every
 * comparison is case-blind, because a link's slug is read as typed.
 *
 * Who may change a slug, and how a slug may be spelled, are the caller's to
 * hold; this module keeps only that a slug names one workspace.
 */

export type WorkspaceSlugEffect<A, E = never> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError | E,
  DatabaseServices
>;

/** Another workspace stands under the slug asked for, or stood under it before. Nothing was written. */
export class WorkspaceSlugTaken extends Data.TaggedError("WorkspaceSlugTaken") {}

/** The slug a workspace stands under, by its own key, compared with case folded. */
function sameSlug(
  column: typeof organization.slug | typeof workspaceFormerSlug.slug,
  slug: string,
) {
  return sql`lower(${column}) = lower(${slug})`;
}

const findCurrentSlug = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ slug: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update"),
    ),
});

const findSlugHolder = SqlSchema.findOneOption({
  Request: Schema.Struct({ slug: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ slug, organizationId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: organization.id })
        .from(organization)
        .where(and(sameSlug(organization.slug, slug), ne(organization.id, organizationId)))
        .unionAll(
          db
            .select({ organizationId: workspaceFormerSlug.organizationId })
            .from(workspaceFormerSlug)
            .where(
              and(
                sameSlug(workspaceFormerSlug.slug, slug),
                ne(workspaceFormerSlug.organizationId, organizationId),
              ),
            ),
        )
        .limit(1),
    ),
});

const findFormerHolder = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (slug) =>
    Database.use((db) =>
      db
        .select({ organizationId: workspaceFormerSlug.organizationId })
        .from(workspaceFormerSlug)
        .where(sameSlug(workspaceFormerSlug.slug, slug))
        .limit(1),
    ),
});

const deleteOwnFormer = SqlSchema.void({
  Request: Schema.Struct({ slug: Schema.String, organizationId: Schema.String }),
  execute: ({ slug, organizationId }) =>
    Database.use((db) =>
      db
        .delete(workspaceFormerSlug)
        .where(
          and(
            sameSlug(workspaceFormerSlug.slug, slug),
            eq(workspaceFormerSlug.organizationId, organizationId),
          ),
        ),
    ),
});

const insertFormer = SqlSchema.void({
  Request: Schema.Struct({ slug: Schema.String, organizationId: Schema.String, now: Schema.Date }),
  execute: ({ slug, organizationId, now }) =>
    Database.use((db) =>
      db
        .insert(workspaceFormerSlug)
        .values({ slug, organizationId, createdAt: now })
        .onConflictDoNothing(),
    ),
});

const updateSlug = SqlSchema.void({
  Request: Schema.Struct({ slug: Schema.String, organizationId: Schema.String }),
  execute: ({ slug, organizationId }) =>
    Database.use((db) =>
      db.update(organization).set({ slug }).where(eq(organization.id, organizationId)),
    ),
});

const findMemberWorkspaceOfSlug = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, slug: Schema.String }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ userId, slug }) =>
    Database.use((db) =>
      db
        .select({ organizationId: organization.id })
        .from(organization)
        .innerJoin(member, eq(member.organizationId, organization.id))
        .leftJoin(workspaceFormerSlug, eq(workspaceFormerSlug.organizationId, organization.id))
        .where(
          and(
            eq(member.userId, userId),
            sql`(${sameSlug(organization.slug, slug)} or ${sameSlug(workspaceFormerSlug.slug, slug)})`,
          ),
        )
        // Note that a workspace standing under the slug now comes before one that stood under it before.
        .orderBy(sql`${sameSlug(organization.slug, slug)} desc`)
        .limit(1),
    ),
});

/**
 * The id of the workspace a link's slug names to the account: the one it
 * is a member of that stands under the slug now, else the one that stood
 * under it before, whatever its case; nothing where it is a member of
 * neither, so a slug never names a workspace to someone outside it. The
 * service's one reading of a link's slug, as `workspaceOfSlug` is the window's.
 */
export function workspaceIdOfSlug(
  userId: string,
  slug: string,
): WorkspaceSlugEffect<Option.Option<string>> {
  return Effect.map(
    findMemberWorkspaceOfSlug({ userId, slug }),
    Option.map((row) => row.organizationId),
  );
}

/** Whether a slug is one some workspace stood under before, whatever its case: a slug no workspace is made under. */
export function formerSlugHeld(slug: string): WorkspaceSlugEffect<boolean> {
  return Effect.map(findFormerHolder(slug), Option.isSome);
}

/**
 * The workspace's slug changed to the one given, the one it stood under
 * kept as its former slug, in one transaction; nothing where it already
 * stands under it, and nothing for a workspace that is gone. Another
 * workspace's slug, now or before, fails taken. Note that changes to one
 * slug take turns, because two workspaces each checking it free would
 * otherwise both take it.
 */
export function setWorkspaceSlug(
  organizationId: string,
  slug: string,
): WorkspaceSlugEffect<void, WorkspaceSlugTaken> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client`select pg_advisory_xact_lock(hashtextextended(lower(${slug}), 0))`;
        const current = yield* findCurrentSlug(organizationId);
        if (Option.isNone(current) || current.value.slug === slug) return;
        if (Option.isSome(yield* findSlugHolder({ slug, organizationId }))) {
          return yield* new WorkspaceSlugTaken();
        }
        const now = yield* DateTime.nowAsDate;
        yield* deleteOwnFormer({ slug, organizationId });
        yield* insertFormer({ slug: current.value.slug, organizationId, now });
        yield* updateSlug({ slug, organizationId });
      }),
    ),
  );
}
