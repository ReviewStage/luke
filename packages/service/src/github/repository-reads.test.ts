import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { createTask, listTasks } from "@repo/database/models/task-store";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  fakeGitHub,
  GITHUB_APP_WITH_TOKENS,
  memberRepositoryJson,
  openGithubUser,
  openTokenMember,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { refreshRepositoryReads } from "./repository-reads.js";

const READER_TOKEN = "fixture-reader-token";
const REFUSED_TOKEN = "fixture-refused-token";
const SIDE = { owner: "octo-member", name: "side" } as const;

function answer(sent: SentToGitHub): Response {
  const reads = sent.headers.get("authorization") === `Bearer ${READER_TOKEN}`;
  const asked = new URL(sent.url).pathname === `/repos/${SIDE.owner}/${SIDE.name}`;
  return asked && reads
    ? Response.json(memberRepositoryJson(SIDE, false))
    : Response.json({ message: "Not Found" }, { status: 404 });
}

it.layer(getTestDB())("a teammate's task on their own GitHub token", (it) => {
  it.effect(
    "shows to a member once GitHub answers their own token with its repository, to no member it answers not found or who keeps no token, and is asked again only after the hour",
    () =>
      Effect.gen(function* () {
        const github = fakeGitHub(answer, GITHUB_APP_WITH_TOKENS);
        const owner = yield* openGithubUser();
        const reader = yield* openTokenMember({ token: READER_TOKEN });
        const refused = yield* openTokenMember({ token: REFUSED_TOKEN });
        const tokenless = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        for (const each of [reader, refused, tokenless]) yield* joinWorkspace(workspace, each);
        const side = yield* createTask(owner, {
          organizationId: workspace,
          repository: "octo-member/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const refresh = (userId: string) =>
          refreshRepositoryReads(userId).pipe(Effect.provide(github.layer));
        const sees = (userId: string) =>
          Effect.map(listTasks(userId), (tasks) => tasks.some((each) => each.id === side.id));

        assert.equal(yield* sees(reader), false, "nothing is seen before GitHub is asked");
        for (const each of [reader, refused, tokenless]) yield* refresh(each);

        assert.deepEqual(
          [yield* sees(owner), yield* sees(reader), yield* sees(refused), yield* sees(tokenless)],
          [true, true, false, false],
        );
        assert.deepEqual(
          github.sent.map((each) => [each.method, new URL(each.url).pathname]),
          [
            ["GET", "/repos/octo-member/side"],
            ["GET", "/repos/octo-member/side"],
          ],
        );
        yield* refresh(reader);
        assert.equal(github.sent.length, 2, "an answer within the hour is not asked again");
        yield* TestClock.adjust("61 minutes");
        yield* refresh(reader);
        assert.equal(github.sent.length, 3);
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );
});
