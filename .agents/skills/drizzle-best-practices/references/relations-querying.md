# Relations: Querying Related Data

## Why It Matters

The relational query API is one of Drizzle's most powerful features. It lets you fetch
nested data (users with their posts, posts with comments and authors) in a single query
without writing manual joins. But using it effectively requires understanding the options
for filtering, limiting, ordering, and selecting columns.

> **Version note:** This file documents the **v1 (RQB v2)** API as the default — `where`/`orderBy`
> take plain objects, and you query through `db.query` (populated by the `defineRelations` object
> you pass to `drizzle()`). If the project is on `drizzle-orm@^0.4x`, use the **Legacy (v0.45.x)**
> forms called out below: operator-based `where`/`orderBy`. See `relations-defining.md` for the
> matching relation-definition syntax.

## Basic Relational Queries

### Fetch all with related data

```typescript
const usersWithPosts = await db.query.users.findMany({
  with: {
    posts: true,
  },
});
// [{ id: 1, name: "Alice", posts: [{ id: 1, title: "Hello", ... }] }]
```

### Find a single record

`findFirst` adds `limit 1` automatically.

```typescript
const user = await db.query.users.findFirst({
  where: { id: 1 },
  with: {
    posts: true,
  },
});
// { id: 1, name: "Alice", posts: [...] } | undefined
```

## Filtering (`where`)

In v1, `where` is a **plain object**, not a callback. Keys are columns (or related tables), and
values are either a literal (shorthand for equality) or an object of operators.

```typescript
// Equality shorthand
await db.query.users.findMany({ where: { age: 15 } });
// → where ("users"."age" = 15)

// Multiple keys are AND-ed together
await db.query.users.findMany({ where: { age: 15, name: 'John' } });
// → where ("users"."age" = 15 and "users"."name" = 'John')

// Operators live in a nested object
await db.query.users.findMany({ where: { age: { gte: 18 }, name: { like: 'John%' } } });
```

Available operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `like`, `ilike`,
`notLike`, `notIlike`, `isNull`, `isNotNull`, `arrayContains`, `arrayContained`, `arrayOverlaps`.

Combine conditions with `AND`, `OR`, `NOT`, and drop to raw SQL with `RAW`:

```typescript
await db.query.users.findMany({
  where: {
    OR: [
      { id: { gt: 10 } },
      { name: { like: 'John%' } },
    ],
  },
});
// → where ("users"."id" > 10 or "users"."name" like 'John%')

await db.query.users.findMany({
  where: {
    NOT: { id: { gt: 10 } },
    name: { like: 'John%' },
  },
});
// → where (not "users"."id" > 10 and "users"."name" like 'John%')

// RAW for expressions the operators don't cover (JSONB paths, BETWEEN, functions, ...)
await db.query.users.findMany({
  where: {
    AND: [
      { RAW: (table) => sql`${table.preferences}->>'theme' = 'dark'` },
      { RAW: (table) => sql`${table.age} BETWEEN 25 AND 35` },
    ],
  },
});
```

### Filter by related tables (new in v1)

You can filter the parent rows by conditions on a related table — no manual join required:

```typescript
// Users with id > 10 who have at least one post whose content starts with "M"
const users = await db.query.users.findMany({
  where: {
    id: { gt: 10 },
    posts: { content: { like: 'M%' } },
  },
});

// Users who have at least one post (existence filter)
const usersWithAnyPost = await db.query.users.findMany({
  with: { posts: true },
  where: { posts: true },
});
```

### Legacy (v0.45.x): callback / operator `where`

On `drizzle-orm@^0.4x`, `where` takes a callback that receives the columns and operator helpers:

```typescript
// Legacy v0.45.x only
const result = await db.query.posts.findMany({
  where: (posts, { eq, and, gt }) =>
    and(eq(posts.published, true), gt(posts.views, 100)),
});
```

The standalone-operator form (`where: eq(posts.published, true)`) is also legacy. In v1, write
`where: { published: true }`. (Note: standalone `eq`/`and`/`gt` are still correct in the SQL-like
builder `db.select().from(posts).where(...)` — that API didn't change.)

## Nested Relations

Nest `with` to fetch deeply related data:

```typescript
const result = await db.query.posts.findMany({
  with: {
    author: true,
    comments: {
      with: {
        author: true,
      },
    },
  },
});
// [{ id: 1, title: "Hello", author: { ... }, comments: [{ content: "...", author: { ... } }] }]
```

## Ordering, Limiting, Paginating

In v1, `orderBy` is an **object** mapping columns to `'asc'` / `'desc'`. `limit` and `offset` work
at both the top level and inside nested `with`.

```typescript
const user = await db.query.users.findFirst({
  where: { id: 1 },
  with: {
    posts: {
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      limit: 10,
      offset: 0,
      with: {
        comments: {
          limit: 3,
          orderBy: { createdAt: 'desc' },
        },
      },
    },
  },
});
```

For expressions, `orderBy` also accepts a callback returning `sql` (no imports needed):

```typescript
await db.query.posts.findMany({
  orderBy: (t) => sql`${t.id} asc`,
});
```

### Legacy (v0.45.x): array / operator `orderBy`

```typescript
// Legacy v0.45.x only
await db.query.posts.findMany({
  orderBy: [desc(posts.createdAt)],
});
```

## Partial Column Selection

Only fetch the columns you need. Drizzle performs the projection in SQL — no extra data is
transferred. This is unchanged between versions.

```typescript
const result = await db.query.users.findMany({
  columns: {
    id: true,
    name: true,
    // email is NOT fetched
  },
  with: {
    posts: {
      columns: {
        title: true,
        // content, authorId, etc. are NOT fetched
      },
    },
  },
});
```

You can also exclude specific columns. When both `true` and `false` appear, the `false` entries
are ignored (you've already restricted the set by including).

```typescript
const result = await db.query.users.findMany({
  columns: {
    password: false, // fetch everything except password
  },
});
```

## Extras (Computed Fields)

Add computed SQL expressions to relational queries. As of v1, aggregations are **not** supported
in `extras` (use the SQL-like builder for `count`/`sum`/etc.), and any `.as('alias')` you add is
ignored — the object key is the alias.

```typescript
const result = await db.query.users.findMany({
  extras: {
    // callback form gives you the table and sql with no imports
    fullName: (users, { sql }) => sql<string>`concat(${users.firstName}, ' ', ${users.lastName})`,
  },
});
// [{ id: 1, firstName: "Alice", lastName: "Smith", fullName: "Alice Smith" }]
```

## Incorrect Patterns

```typescript
// Wrong: using the relational API for aggregations — it doesn't support COUNT, SUM, etc.
// Use db.select() with the sql operator instead.
const count = await db.query.users.findMany(); // fetches ALL rows just to count them
// Better:
const [{ count }] = await db
  .select({ count: sql<number>`count(*)`.mapWith(Number) })
  .from(users);

// Wrong (v1): callback where — this is the legacy 0.45.x form
const bad = await db.query.users.findMany({
  where: (users, { eq }) => eq(users.age, 15), // ❌ on v1
});
// Right (v1):
const good = await db.query.users.findMany({ where: { age: 15 } });

// Wrong: deeply nesting without limits — fetches ALL related data at every level
const result = await db.query.users.findMany({
  with: {
    posts: {
      with: {
        comments: {
          with: {
            author: true,
            likes: true, // could be thousands per comment
          },
        },
      },
    },
  },
});
// Always add limits when nesting deeply.
```

## References

- https://orm.drizzle.team/docs/rqb-v2
- https://orm.drizzle.team/docs/relations-v1-v2 (migrating queries from v1 to v2)
