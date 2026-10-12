# Types: Schema Validators (Zod / Valibot / Typebox / Arktype)

## Why It Matters

Your Drizzle table already encodes column types, nullability, and which columns are generated.
Re-declaring that shape by hand in a Zod (or Valibot/Typebox/Arktype) schema for request/response
validation duplicates the source of truth and drifts over time. Drizzle can derive validation
schemas directly from a table so an API stays in sync with the database automatically.

> **Version note:** In **Drizzle v1**, the validator builders ship *inside* `drizzle-orm` —
> import from `drizzle-orm/zod`, `drizzle-orm/valibot`, `drizzle-orm/typebox`, or
> `drizzle-orm/arktype`. On **0.45.x** they live in the separate `drizzle-zod` / `drizzle-valibot`
> / etc. packages. The function names are the same; only the import path differs.

## v1 Usage (`drizzle-orm/zod`)

Three builders cover the common cases:

- `createSelectSchema(table)` — shape of rows you read back (validate API responses).
- `createInsertSchema(table)` — shape required to insert (generated columns become optional/omitted,
  `.notNull()` columns are required).
- `createUpdateSchema(table)` — shape for updates (everything optional; generated columns rejected).

```typescript
import { pgTable, text, integer } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod';

const users = pgTable('users', {
  id: integer().generatedAlwaysAsIdentity().primaryKey(),
  name: text().notNull(),
  age: integer().notNull(),
});

const userInsertSchema = createInsertSchema(users);
// { name: string; age: number }  — `id` is generated, so it's not required

const parsed = userInsertSchema.parse({ name: 'Jane', age: 30 });
await db.insert(users).values(parsed);

const userSelectSchema = createSelectSchema(users);
const rows = await db.select().from(users).limit(1);
const row = userSelectSchema.parse(rows[0]); // { id: number; name: string; age: number }
```

Enums and views are supported too:

```typescript
const roles = pgEnum('roles', ['admin', 'basic']);
const rolesSchema = createSelectSchema(roles); // z.enum(['admin', 'basic'])
```

## Refinements

Pass a second argument to extend or overwrite individual fields. A **callback** extends the derived
schema; a **schema value** replaces the field entirely (including its nullability).

```typescript
import { z } from 'zod/v4';
import { createSelectSchema } from 'drizzle-orm/zod';

const userSelectSchema = createSelectSchema(users, {
  name: (schema) => schema.max(20),              // extend
  bio: (schema) => schema.max(1000),             // extend
  preferences: z.object({ theme: z.string() }),  // overwrite
});
```

## Factory (extended Zod instance, coercion)

Use `createSchemaFactory` when you need an extended Zod instance (e.g. `@hono/zod-openapi`) or
automatic coercion:

```typescript
import { createSchemaFactory } from 'drizzle-orm/zod';

const { createInsertSchema } = createSchemaFactory({
  coerce: { date: true }, // or `coerce: true` for all types
});
```

## Incorrect / Correct

```typescript
// Wrong (v1): importing from the standalone package that v1 deprecated
import { createInsertSchema } from 'drizzle-zod'; // ❌ on @rc — use drizzle-orm/zod

// Right (v1):
import { createInsertSchema } from 'drizzle-orm/zod'; // ✅

// Wrong: hand-writing a Zod schema that mirrors the table — drifts when the table changes
const manualInsert = z.object({ name: z.string(), age: z.number() }); // ❌ duplicates the schema

// Right: derive it so it tracks the table
const userInsert = createInsertSchema(users); // ✅
```

## Legacy (v0.45.x)

Same API, separate packages and imports:

```typescript
// Drizzle 0.45.x
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
// or 'drizzle-valibot', 'drizzle-typebox', 'drizzle-arktype'
```

Note: in v1, `typebox` has two paths — `drizzle-orm/typebox` (using the `typebox` package) and
`drizzle-orm/typebox-legacy` (using `@sinclair/typebox`).

## References

- https://orm.drizzle.team/docs/zod
- https://orm.drizzle.team/docs/valibot
- https://orm.drizzle.team/docs/upgrade-v1 (validator package consolidation)
