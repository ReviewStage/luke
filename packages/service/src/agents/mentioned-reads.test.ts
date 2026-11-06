import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createTask } from "@repo/database/models/task-store";
import { organization, user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { mentionedContext } from "./mentioned-context.js";
import { readMentioned } from "./mentioned-reads.js";

const DESCRIPTION = { body: "## Rollout\n\nStore first, then the desktop.", assumptions: [] };

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const slugOf = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, organizationId));
    return row?.slug ?? assert.fail("the workspace was not written");
  });

const numberedSection = (ownerId: string) =>
  Effect.gen(function* () {
    const workspace = yield* openWorkspace(ownerId);
    const created = yield* createTask(ownerId, { name: "Invites", organizationId: workspace });
    const slug = yield* slugOf(workspace);
    const words = `Follow [@Rollout](${LINK_ORIGIN}/${slug}/task/${created.number}#rollout).`;
    return { workspace, task: { ...created, document: DESCRIPTION }, words };
  });

const agentTask = (ownerId: string) =>
  Effect.gen(function* () {
    const workspace = yield* openWorkspace(ownerId);
    const created = yield* createTask(ownerId, { name: "Billing", organizationId: workspace });
    return { workspace, task: { ...created, document: DESCRIPTION } };
  });

it.layer(getTestDB())("a task a message names by its number", (it) => {
  it.effect(
    "is handed as its description's section where the sender is a member of its workspace",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const { workspace, task, words } = yield* numberedSection(dean);

        const reads = yield* readMentioned(dean, words, { task, workspaceId: workspace });

        assert.match(
          mentionedContext(words, task, reads) ?? "",
          /Store first, then the desktop\./u,
        );
      }),
  );

  it.effect("is handed nothing where the sender is no member of the workspace it names", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const stranger = yield* openAccount;
      yield* openWorkspace(stranger);
      const { workspace, task, words } = yield* numberedSection(dean);

      const reads = yield* readMentioned(stranger, words, { task, workspaceId: workspace });

      assert.equal(mentionedContext(words, task, reads), undefined);
    }),
  );

  it.effect(
    "is handed its id, as another task than the agent's, where the sender is a member of its workspace",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const { task: named, words } = yield* numberedSection(dean);
        const { workspace, task } = yield* agentTask(dean);

        const reads = yield* readMentioned(dean, words, { task, workspaceId: workspace });

        assert.match(mentionedContext(words, task, reads) ?? "", new RegExp(named.id, "u"));
      }),
  );

  it.effect(
    "is handed no id, as another task than the agent's, where the sender is no member of its workspace",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const stranger = yield* openAccount;
        const { words } = yield* numberedSection(dean);
        const { workspace, task } = yield* agentTask(stranger);

        const reads = yield* readMentioned(stranger, words, { task, workspaceId: workspace });

        assert.equal(mentionedContext(words, task, reads), undefined);
      }),
  );
});
