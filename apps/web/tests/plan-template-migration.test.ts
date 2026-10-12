import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { type PlanFieldWriter, planBody } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, PLAN_FIELD, type PlanFields } from "@sidecar/hosted/plan-wire";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { readRevisionContent } from "../server/hosted/plan-revisions";
import { readPlan } from "../server/hosted/plan-store";
import { BULK_IMPORT } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";
import { openWorkspace } from "./support/workspaces";

/**
 * plan-template-migration.test.ts -- migration 0082 carries a plan written in the old template onto the new one.
 *
 * A plan and a revision stored in the old template's shape are written as
 * raw rows on a migrated database, the migration's statements are run over
 * them again, and the plan is read back through the store: its body is
 * formatted from the carried fields under the new headings, each old answer's
 * words stand under the section that took it, the revision still decodes,
 * and each field's writer names the new field, the newest writer kept where
 * two old fields became one. A plan already in the new shape is left as it
 * stood. Synthetic accounts and plans throughout.
 */

const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL("../drizzle/0082_plan_template_teammate.sql", import.meta.url)),
  "utf8",
);

const MIGRATION_STATEMENTS = MIGRATION_SQL.split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

const NAME = "Teammate invitations";

const CONTRACT = "```ts\nexport function invite(email: string): Effect<Invite, InviteError>;\n```";

/** A plan's fields as the old template kept them. */
const OLD_FIELDS = {
  goal: { problem: "Only an admin can add a member.", outcome: "Any member invites by email." },
  scope: {
    included: "The invite screen.",
    excluded: "Invites by single sign-on.",
    constraints: "Links expire in a week.",
  },
  rules: [
    {
      statement: "A withdrawn invite never grants access.",
      examples: [
        // biome-ignore lint/suspicious/noThenProperty: `then` is the old template's example key, and an example is data that is never awaited.
        { given: "a withdrawn invite", when: "its link is opened", then: "the page says so" }, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      ],
    },
  ],
  implementation: {
    changeMap: "- `src/invites.ts`: new.",
    contracts: CONTRACT,
    patterns: null,
    order: "1. The store.\n2. The screen.",
  },
  decisions: "Email only, because a shared link leaks.",
  verification: "A store test withdraws an invite and opens its link.",
  leftToAgent: null,
  openQuestions: ["Who may withdraw an invite?"],
  dataAndMigration: null,
};

/** Who last wrote each old field: two of them, at different times, become one new field. */
const OLD_WRITERS = [
  { field: "problem", actor: PLAN_ACTOR.DEVELOPER, at: 1_000 },
  { field: "changeMap", actor: PLAN_ACTOR.NOTETAKER, duringCall: true, at: 3_000 },
  { field: "decisions", actor: PLAN_ACTOR.DEVELOPER, at: 2_000 },
  { field: "verification", actor: PLAN_ACTOR.NOTETAKER, at: 4_000 },
];

/** A plan's fields as a row may hold them: in the new template's shape or the old one's. */
type StoredFields = PlanFields | typeof OLD_FIELDS;

/** A plan's writers as a row may hold them: naming the new fields or the old ones. */
type StoredWriters = readonly PlanFieldWriter[] | typeof OLD_WRITERS;

const NEW_WRITERS: readonly PlanFieldWriter[] = [
  { field: PLAN_FIELD.APPROACH, actor: PLAN_ACTOR.DEVELOPER, at: 5_000 },
];

/** What stands under one heading of a body, up to the heading named after it. */
function between(body: string, from: string, to: string): string {
  const start = body.indexOf(`\n${from}\n`);
  const end = body.indexOf(`\n${to}\n`, start + 1);
  assert.ok(start !== -1 && end !== -1, `the body holds ${from} before ${to}`);
  return body.slice(start + from.length + 2, end).trim();
}

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A plan row written as raw SQL, whatever shape its fields are in. */
const insertPlan = (input: {
  readonly userId: string;
  readonly body: string;
  readonly fields: StoredFields;
  readonly writers: StoredWriters;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const planId = randomUUID();
    const organizationId = yield* openWorkspace(input.userId);
    yield* sql`
      insert into plan (id, user_id, organization_id, name, body, fields, field_writers)
      values (${planId}, ${input.userId}, ${organizationId}, ${NAME}, ${input.body},
        ${JSON.stringify(input.fields)}::jsonb, ${JSON.stringify(input.writers)}::jsonb)
    `;
    return planId;
  });

const insertRevision = (planId: string, fields: StoredFields) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into plan_revision (plan_id, seq, actor, fields, assumptions, changes, started_at, at)
      values (${planId}, 1, ${PLAN_ACTOR.NOTETAKER}, ${JSON.stringify(fields)}::jsonb,
        '[]'::jsonb, 1, now(), now())
    `;
  });

const runMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of MIGRATION_STATEMENTS) yield* sql.unsafe(statement);
});

const storedOf = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), Option.getOrThrow);

it.layer(testSqlClient)("migration 0082 onto the teammate template", (it) => {
  it.effect(
    "an old plan reads in the new sections, its revision decodes, and each field's newest writer names the new field",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const planId = yield* insertPlan({
          userId,
          body: "# Teammate invitations\n\n## Goal\n\n### Problem\n\nOnly an admin can add a member.\n",
          fields: OLD_FIELDS,
          writers: OLD_WRITERS,
        });
        yield* insertRevision(planId, OLD_FIELDS);

        yield* runMigration;

        const stored = yield* storedOf(userId, planId);
        const { body } = stored.plan.document;
        assert.deepEqual(
          body.split("\n").filter((line) => line.startsWith("#")),
          [
            "# Teammate invitations",
            "## Context",
            "## Goal",
            "## Approach",
            "## Interfaces",
            "## Hard parts",
            "## Not doing",
            "## Plan of attack",
            "## Testing",
            "## Open questions",
          ],
        );
        assert.equal(between(body, "## Context", "## Goal"), "Only an admin can add a member.");
        assert.equal(between(body, "## Goal", "## Approach"), "Any member invites by email.");
        assert.equal(
          between(body, "## Approach", "## Interfaces"),
          [
            "**Included**",
            "The invite screen.",
            "**Change map**",
            "- `src/invites.ts`: new.",
            "**Decisions**",
            "Email only, because a shared link leaks.",
          ].join("\n\n"),
        );
        assert.equal(between(body, "## Interfaces", "## Hard parts"), CONTRACT);
        assert.equal(
          between(body, "## Hard parts", "## Not doing"),
          [
            "**Constraints**",
            "Links expire in a week.",
            "**Rules**",
            "- A withdrawn invite never grants access.\n" +
              "  - Given a withdrawn invite, when its link is opened, then the page says so",
          ].join("\n\n"),
        );
        assert.equal(
          between(body, "## Not doing", "## Plan of attack"),
          "Invites by single sign-on.",
        );
        assert.equal(
          between(body, "## Plan of attack", "## Testing"),
          "**Order**\n\n1. The store.\n2. The screen.",
        );
        assert.equal(
          between(body, "## Testing", "## Open questions"),
          "A store test withdraws an invite and opens its link.",
        );
        assert.ok(body.endsWith("## Open questions\n\n- Who may withdraw an invite?\n"));

        const revision = Option.getOrThrow(yield* readRevisionContent(userId, planId, 1));
        assert.ok("fields" in revision, "the revision is the template's fields");
        assert.deepEqual(revision.fields, stored.fields);

        assert.deepEqual(stored.fieldWriters, [
          { field: PLAN_FIELD.CONTEXT, actor: PLAN_ACTOR.DEVELOPER, at: 1_000 },
          { field: PLAN_FIELD.APPROACH, actor: PLAN_ACTOR.NOTETAKER, duringCall: true, at: 3_000 },
          { field: PLAN_FIELD.TESTING, actor: PLAN_ACTOR.NOTETAKER, at: 4_000 },
        ]);
      }),
  );

  it.effect("a plan already in the new template is left as it stood", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const body = planBody({ name: NAME }, BULK_IMPORT.fields);
      const planId = yield* insertPlan({
        userId,
        body,
        fields: BULK_IMPORT.fields,
        writers: NEW_WRITERS,
      });
      yield* insertRevision(planId, BULK_IMPORT.fields);
      const before = yield* storedOf(userId, planId);

      yield* runMigration;

      const after = yield* storedOf(userId, planId);
      assert.equal(after.plan.document.body, body);
      assert.deepEqual(after.fields, BULK_IMPORT.fields);
      assert.deepEqual(after.fieldWriters, NEW_WRITERS);
      assert.deepEqual(after, before);
      const revision = Option.getOrThrow(yield* readRevisionContent(userId, planId, 1));
      assert.ok("fields" in revision, "the revision is the template's fields");
      assert.deepEqual(revision.fields, BULK_IMPORT.fields);
    }),
  );
});
