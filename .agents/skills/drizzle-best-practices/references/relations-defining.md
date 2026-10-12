# Relations: Defining Relations

## Why It Matters

Relations let you describe how tables connect to each other. Once defined, you can use
the relational query API (`db.query`) to fetch nested data without writing manual joins.
Drizzle supports two relation APIs — the modern `defineRelations` (RQB v2, the default in
Drizzle v1) and the legacy `relations()` helper (Drizzle 0.45.x). New projects on `@rc` should
use `defineRelations`.

## Relations v2 (`defineRelations`) — Recommended (Drizzle v1)

```typescript
import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

export const relations = defineRelations(schema, (r) => ({
  users: {
    posts: r.many.posts(),
    profile: r.one.profiles({
      from: r.users.id,
      to: r.profiles.userId,
    }),
  },
  posts: {
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
    }),
    comments: r.many.comments(),
  },
  comments: {
    post: r.one.posts({
      from: r.comments.postId,
      to: r.posts.id,
    }),
    author: r.one.users({
      from: r.comments.authorId,
      to: r.users.id,
    }),
  },
  profiles: {
    user: r.one.users({
      from: r.profiles.userId,
      to: r.users.id,
    }),
  },
}));

// Pass relations to drizzle()
const db = drizzle({ client: pool, relations });
```

**Key points:**
- `r.one` requires explicit `from`/`to` column mapping
- `r.many` infers the connection from the other side's `r.one` definition
- Both sides of a relationship should be defined for full query support

## Legacy Relations API (`relations()`)

Still works and widely used in existing projects:

```typescript
// Drizzle 0.45.x: import from 'drizzle-orm'
// Drizzle v1 (if you keep the legacy API): import from 'drizzle-orm/_relations'
import { relations } from 'drizzle-orm';

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));
```

**Note:** The legacy API requires passing the entire schema to `drizzle()`:

```typescript
import * as schema from './schema';
const db = drizzle({ schema });
```

**Migrating from 0.45.x to v1.** On Drizzle v1 the relational query API (`db.query`) is driven by
the `defineRelations` object you pass to `drizzle()`. Passing a legacy `schema` (with `relations()`
helpers) does *not* populate `db.query` — verified empirically against `drizzle-orm@1.0.0-rc.3`:

```typescript
// ✅ v1: relational queries require defineRelations passed as `relations`
import { relations } from './relations'; // export const relations = defineRelations(...)
const db = drizzle(process.env.DATABASE_URL!, { relations });
await db.query.users.findMany({ with: { posts: true } });

// ⚠️ v1: the legacy relations() helper still imports from drizzle-orm/_relations
// (so old definition files keep compiling), but passing it via `schema` does NOT
// enable db.query. Convert relation definitions to defineRelations to query relationally.
import { relations } from 'drizzle-orm/_relations';
```

> Some v1 beta docs describe a `db._query` path for running legacy relational queries side by side
> with the new API. That path was **removed before `1.0.0-rc.3`** — there is no `db._query`. Don't
> rely on it; migrate definitions to `defineRelations`.

## Many-to-Many Relations

You still need the junction table in your schema, but in v1 you no longer query *through* it.
Use `.through()` to point both sides of the `many` relation at the junction columns, and Drizzle
collapses the join for you:

```typescript
// Schema — junction table
export const usersToGroups = pgTable(
  'users_to_groups',
  {
    userId: integer('user_id').notNull().references(() => users.id),
    groupId: integer('group_id').notNull().references(() => groups.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })]
);

// Relations v2 — define the many-to-many directly with .through()
export const relations = defineRelations(schema, (r) => ({
  users: {
    groups: r.many.groups({
      from: r.users.id.through(r.usersToGroups.userId),
      to: r.groups.id.through(r.usersToGroups.groupId),
    }),
  },
  groups: {
    users: r.many.users(), // reverse side; the through mapping is inferred
  },
}));
```

### Querying — no junction in the query

```typescript
const usersWithGroups = await db.query.users.findMany({
  with: {
    groups: true, // junction table is collapsed automatically
  },
});
// [{ id: 1, name: "Alice", groups: [{ id: 7, name: "Admins" }] }]
```

### Legacy (v0.45.x): query through the junction table

Before v1's `.through()`, you defined a `many` to the junction on each side and traversed it
explicitly in the query, mapping the rows out yourself:

```typescript
// Legacy v0.45.x
export const usersRelations = relations(users, ({ many }) => ({
  usersToGroups: many(usersToGroups),
}));
// ...
const usersWithGroups = await db.query.users.findMany({
  with: {
    usersToGroups: {
      columns: {},
      with: { group: true },
    },
  },
});
```

## Incorrect

```typescript
// Forgetting to define the reverse side of a relation
export const relations = defineRelations(schema, (r) => ({
  posts: {
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
    }),
  },
  // Missing: users.posts relation
  // Without it, you can't query db.query.users.findMany({ with: { posts: true } })
}));
```

## Self-Referencing Relations

For hierarchical data like comment threads or org charts:

```typescript
import { AnyPgColumn } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  invitedBy: integer('invited_by').references((): AnyPgColumn => users.id),
});
```

Note the `(): AnyPgColumn =>` return type annotation — this is needed for circular references.

## References

- https://orm.drizzle.team/docs/relations-v2
- https://orm.drizzle.team/docs/rqb
