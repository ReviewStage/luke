import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { planFieldsSchema } from "@sidecar/hosted/plan-template";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { saveNotes } from "../server/hosted/plan-notes";
import { createPlan, readPlan } from "../server/hosted/plan-store";
import { INVITATIONS_DRAFT, notesFor, templateHeadingsOf } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";

/**
 * Migration 0074 carries every plan written in the old template onto the new
 * one: a plan row and a revision row whose fields are the old shape, written
 * past the store as an older deployment left them, are migrated again by the
 * file's own statements, and the plan then reads through the store's public
 * read with each old answer under the section it now belongs to, while a
 * plan already in the new shape is left as it stood. Synthetic accounts and
 * plans throughout.
 */

const MIGRATION = readFileSync(
  new URL("../drizzle/0074_plan_template_teammate.sql", import.meta.url),
  "utf8",
);

/** The migration's statements, split the way the runner splits them. */
const MIGRATION_STATEMENTS = MIGRATION.split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/** What the old plan said, each in the old field that held it. */
const OLD = {
  PROBLEM: "Only an admin can add someone to a workspace.",
  OUTCOME: "A member invites a teammate by email.",
  INCLUDED: "Inviting by email from the members screen.",
  EXCLUDED: "Inviting by link, and bulk invites.",
  CONSTRAINTS: "An invite expires after 7 days.",
  RULE: "Any member may invite by email.",
  GIVEN: "A member invites dana@example.com",
  WHEN: "Dana opens the link",
  THEN: "Dana joins the workspace",
  CHANGE_MAP: "- `src/members/invite.ts`: new, sending and accepting an invite.",
  CONTRACTS: '```ts\nexport type MembershipState = "active" | "pending";\n```',
  ORDER: "1. The pending state.\n2. The invite screen.",
  DECISION: "Model an invite as a `memberships` row with `state = pending`.",
  VERIFICATION: "A store test accepts an invite and finds the member.",
  QUESTION: "Who can withdraw an invite?",
} as const;

/** A plan's fields as the old template kept them. */
const OLD_FIELDS = {
  goal: { problem: OLD.PROBLEM, outcome: OLD.OUTCOME },
  scope: { included: OLD.INCLUDED, excluded: OLD.EXCLUDED, constraints: OLD.CONSTRAINTS },
  rules: [
    {
      statement: OLD.RULE,
      examples: [
        {
          given: OLD.GIVEN,
          when: OLD.WHEN,
          // biome-ignore lint/suspicious/noThenProperty: `then` was the old template's example key, and an example is data that is never awaited.
          then: OLD.THEN, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
        },
      ],
    },
  ],
  implementation: {
    changeMap: OLD.CHANGE_MAP,
    contracts: OLD.CONTRACTS,
    patterns: null,
    order: OLD.ORDER,
  },
  decisions: OLD.DECISION,
  verification: OLD.VERIFICATION,
  leftToAgent: null,
  openQuestions: [OLD.QUESTION],
  dataAndMigration: null,
};

const OLD_ASSUMPTIONS = [{ text: "Invites reuse `memberships`." }];

const RevisionFieldsRow = Schema.Struct({
  fields: Schema.fromJsonString(planFieldsSchema),
});

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A plan and its one revision as an older deployment wrote them, past the store's schema. */
const writeOldPlan = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const fields = JSON.stringify(OLD_FIELDS);
    const assumptions = JSON.stringify(OLD_ASSUMPTIONS);
    const rows = yield* sql.unsafe<{ readonly id: string }>(
      `INSERT INTO "plan" ("user_id", "name", "body", "assumptions", "fields")
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING "id"`,
      [userId, "Teammate invitations", "# Teammate invitations\n\n## Goal\n", assumptions, fields],
    );
    const planId = rows[0]?.id ?? assert.fail("the plan insert returned no row");
    yield* sql.unsafe(
      `INSERT INTO "plan_revision"
         ("plan_id", "seq", "actor", "fields", "assumptions", "changes", "started_at", "at")
       VALUES ($1, 1, 'notetaker', $2::jsonb, $3::jsonb, 3, now(), now())`,
      [planId, fields, assumptions],
    );
    return planId;
  });

const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(MIGRATION_STATEMENTS, (statement) => sql.unsafe(statement), {
    discard: true,
  });
});

/** What stands under one heading of a body, up to the heading named after it. */
function between(body: string, from: string, to: string): string {
  const start = body.indexOf(`\n${from}\n`);
  const end = body.indexOf(`\n${to}\n`, start + 1);
  assert.ok(start !== -1 && end !== -1, `the body holds ${from} before ${to}`);
  return body.slice(start + from.length + 2, end).trim();
}

it.layer(testSqlClient)("migration 0074 onto the teammate template", (it) => {
  it.effect(
    "an old-shaped plan reads in the new template with each old answer under its new section",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const planId = yield* writeOldPlan(userId);

        yield* migrate;

        const stored = Option.getOrThrow(yield* readPlan(userId, planId));
        const { body, assumptions } = stored.plan.document;
        assert.ok(body.startsWith("# Teammate invitations\n"));
        assert.deepEqual(templateHeadingsOf(body), [
          "## Context",
          "## Goal",
          "## Approach",
          "## Interfaces",
          "## Hard parts",
          "## Not doing",
          "## Plan of attack",
          "## Testing",
          "## Open questions",
        ]);
        assert.equal(between(body, "## Context", "## Goal"), OLD.PROBLEM);
        assert.equal(between(body, "## Goal", "## Approach"), OLD.OUTCOME);
        const approach = between(body, "## Approach", "## Interfaces");
        for (const said of [OLD.INCLUDED, OLD.CHANGE_MAP, OLD.DECISION]) {
          assert.ok(approach.includes(said), `the approach carries: ${said}`);
        }
        assert.equal(between(body, "## Interfaces", "## Hard parts"), OLD.CONTRACTS);
        const hardParts = between(body, "## Hard parts", "## Not doing");
        assert.ok(hardParts.includes(OLD.CONSTRAINTS));
        assert.ok(hardParts.includes(`- ${OLD.RULE}`));
        assert.ok(hardParts.includes(`Given ${OLD.GIVEN}, when ${OLD.WHEN}, then ${OLD.THEN}`));
        assert.equal(between(body, "## Not doing", "## Plan of attack"), OLD.EXCLUDED);
        assert.ok(between(body, "## Plan of attack", "## Testing").includes(OLD.ORDER));
        assert.equal(between(body, "## Testing", "## Open questions"), OLD.VERIFICATION);
        assert.ok(body.endsWith(`## Open questions\n\n- ${OLD.QUESTION}\n`));
        assert.deepEqual(assumptions, OLD_ASSUMPTIONS);
        assert.equal(stored.fields.alternatives, null);
      }),
  );

  it.effect("an old-shaped revision's fields decode in the new template after it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const planId = yield* writeOldPlan(userId);

      yield* migrate;

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql.unsafe(
        `SELECT "fields"::text AS "fields" FROM "plan_revision" WHERE "plan_id" = $1`,
        [planId],
      );
      const revisions = yield* Schema.decodeUnknownEffect(Schema.Array(RevisionFieldsRow))(rows);
      const stored = Option.getOrThrow(yield* readPlan(userId, planId));
      assert.deepEqual(
        revisions.map((revision) => revision.fields),
        [stored.fields],
      );
    }),
  );

  it.effect("a plan already in the new template is left as it stood", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* createPlan(userId, { name: "Teammate invitations" });
      yield* saveNotes({ userId, planId }, notesFor(INVITATIONS_DRAFT));
      const before = yield* readPlan(userId, planId);

      yield* migrate;

      assert.deepEqual(yield* readPlan(userId, planId), before);
    }),
  );
});
