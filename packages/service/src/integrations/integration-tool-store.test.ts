import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { noNetwork } from "@repo/wire/testing";
import { DateTime, Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { openGithubUser } from "../testing/github-app-fake.js";
import { firstIntegrationAccount } from "../testing/integration-connect.js";
import { beginIntegrationSignIn, completeIntegrationSignIn } from "./integration-store.js";
import { INTEGRATION_GRANT_HOLDER, type IntegrationGrantRef } from "./integration-token.js";
import { readStoredTools, storeTools } from "./integration-tool-store.js";

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

const TOOLS = [{ name: "list_issues", description: "List issues." }, { name: "create_issue" }];

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
        const before = yield* DateTime.nowAsDate;
        yield* storeTools(member.grant, TOOLS, before);
        yield* TestClock.adjust(Duration.minutes(1));

        yield* beginIntegrationSignIn(
          member.userId,
          firstIntegrationAccount(member.userId, LINEAR),
          "again",
        );
        yield* completeIntegrationSignIn(member.userId, LINEAR, "again");
        const cleared = yield* readStoredTools(member.grant);
        yield* storeTools(member.grant, TOOLS, before);

        assert.equal(cleared, undefined);
        assert.equal(yield* readStoredTools(member.grant), undefined);
      }),
  );

  it.effect("a list whose read began before the kept one's is not kept over it", () =>
    Effect.gen(function* () {
      const member = yield* connectedMember;
      const earlier = yield* DateTime.nowAsDate;
      yield* TestClock.adjust(Duration.seconds(1));
      const later = yield* DateTime.nowAsDate;
      const newer = [...TOOLS, { name: "archive_issue" }];

      yield* storeTools(member.grant, newer, later);
      yield* storeTools(member.grant, TOOLS, earlier);

      assert.deepEqual(yield* readStoredTools(member.grant), { tools: newer, listedAt: later });
    }),
  );
});
