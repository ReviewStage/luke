import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { organization } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { noNetwork } from "@luke/wire/testing";
import { DateTime, Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { openGithubUser } from "../testing/github-app-fake.js";
import { firstIntegrationAccount } from "../testing/integration-connect.js";
import { beginIntegrationSignIn, completeIntegrationSignIn } from "./integration-store.js";
import { INTEGRATION_GRANT_HOLDER, type IntegrationGrantRef } from "./integration-token.js";
import { readStoredTools, storeTools } from "./integration-tool-store.js";
import {
  beginWorkspaceIntegrationSignIn,
  completeWorkspaceIntegrationSignIn,
} from "./workspace-integration-store.js";

/**
 * The tools kept on a grant's row over the real migration on PGlite: a
 * list is read back for its own grant alone, a sign-in completed again
 * clears it on the account's row and the workspace's alike, and a list read
 * before that sign-in completed is never kept over it.
 */

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

/** The tools a list holds, as the provider named them. */
const TOOLS = [{ name: "list_issues", description: "List issues." }, { name: "create_issue" }];

/** A member whose Linear stands connected, and the grant it stands for. */
const connectedMember = Effect.gen(function* () {
  const userId = yield* openGithubUser();
  yield* beginIntegrationSignIn(userId, firstIntegrationAccount(userId, LINEAR), `s-${userId}`);
  yield* completeIntegrationSignIn(userId, LINEAR, `s-${userId}`);
  const grant: IntegrationGrantRef = {
    holder: INTEGRATION_GRANT_HOLDER.ACCOUNT,
    provider: LINEAR,
    userId,
    connectionName: LINEAR,
    connectSubject: userId,
  };
  return { userId, grant };
});

/** A workspace whose Linear stands connected, and the grant it stands for. */
const connectedWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const organizationId = randomUUID();
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Test Workspace",
      slug: `workspace-${organizationId}`,
      createdAt: yield* DateTime.nowAsDate,
    });
    yield* beginWorkspaceIntegrationSignIn(organizationId, LINEAR, userId, `w-${organizationId}`);
    yield* completeWorkspaceIntegrationSignIn(organizationId, LINEAR, `w-${organizationId}`);
    const grant: IntegrationGrantRef = {
      holder: INTEGRATION_GRANT_HOLDER.WORKSPACE,
      provider: LINEAR,
      organizationId,
    };
    return grant;
  });

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the tools kept on a grant", (it) => {
  it.effect("a grant's list is read back for that grant, and never for another account's", () =>
    Effect.gen(function* () {
      const mine = yield* connectedMember;
      const theirs = yield* connectedMember;
      const listedAt = yield* DateTime.nowAsDate;

      yield* storeTools(mine.grant, TOOLS, listedAt);

      assert.deepEqual(yield* readStoredTools(mine.grant), { tools: TOOLS, listedAt });
      assert.equal(yield* readStoredTools(theirs.grant), undefined);
    }),
  );

  it.effect(
    "a sign-in completed again clears the list, and a list read before it completed is not kept",
    () =>
      Effect.gen(function* () {
        const member = yield* connectedMember;
        const workspace = yield* connectedWorkspace(member.userId);
        const before = yield* DateTime.nowAsDate;
        yield* storeTools(member.grant, TOOLS, before);
        yield* storeTools(workspace, TOOLS, before);
        yield* TestClock.adjust(Duration.minutes(1));

        yield* beginIntegrationSignIn(
          member.userId,
          firstIntegrationAccount(member.userId, LINEAR),
          "again",
        );
        yield* completeIntegrationSignIn(member.userId, LINEAR, "again");
        yield* beginWorkspaceIntegrationSignIn(
          workspace.organizationId,
          LINEAR,
          member.userId,
          "w-again",
        );
        yield* completeWorkspaceIntegrationSignIn(workspace.organizationId, LINEAR, "w-again");
        const cleared = [yield* readStoredTools(member.grant), yield* readStoredTools(workspace)];
        // A list whose read began before the sign-in completed was read on the grant it replaced.
        yield* storeTools(member.grant, TOOLS, before);
        yield* storeTools(workspace, TOOLS, before);

        assert.deepEqual(cleared, [undefined, undefined]);
        assert.equal(yield* readStoredTools(member.grant), undefined);
        assert.equal(yield* readStoredTools(workspace), undefined);
      }),
  );
});
