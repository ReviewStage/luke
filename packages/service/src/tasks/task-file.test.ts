import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { readGitHubTokenRow } from "@luke/database/models/github-token-store";
import { getTestDB, startTask } from "@luke/database/testing";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { TASK_FILE_REFUSAL } from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import {
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE_MEMBER,
  githubReaching,
  memberRepositoryJson,
  openTokenMember,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { readTaskFile } from "./task-file.js";

/**
 * The File tab's read of a task's repository on the member's own token,
 * where no installation reaches it: GitHub is asked with the documented
 * Bearer header, and a 401 marks the token invalid. GitHub is a script and
 * the store PGlite. Synthetic accounts, repositories, and tokens throughout.
 */

const SIDE = { owner: "octo-member", name: "side", defaultBranch: "main" } as const;
const SIDE_FULL_NAME = `${SIDE.owner}/${SIDE.name}`;
const HEAD = "a".repeat(40);
const README = { path: "README.md", firstLine: 1, lastLine: 1 } as const;

/** GitHub answering the member's token on the repository, its head, and its README; the README read refused 401 where `refused` says so. */
const onMemberToken =
  (refused = false) =>
  (sent: SentToGitHub): Response | undefined => {
    if (sent.headers.get("authorization") !== `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`) return;
    const { pathname } = new URL(sent.url);
    if (pathname === `/repos/${SIDE_FULL_NAME}`) {
      return Response.json(memberRepositoryJson(SIDE, true));
    }
    if (pathname === `/repos/${SIDE_FULL_NAME}/git/ref/heads/main`) {
      return Response.json({ object: { type: "commit", sha: HEAD } });
    }
    if (pathname !== `/repos/${SIDE_FULL_NAME}/contents/README.md`) return;
    if (refused) return Response.json({ message: "Bad credentials" }, { status: 401 });
    const content = Buffer.from("# Side\n").toString("base64");
    return Response.json({ type: "file", size: 7, encoding: "base64", content });
  };

const readReadme = (refused: boolean) =>
  Effect.gen(function* () {
    const github = githubReaching([], GITHUB_APP_WITH_TOKENS, {}, onMemberToken(refused));
    const userId = yield* openTokenMember();
    const task = yield* startTask(userId, { name: "Side work", repository: SIDE_FULL_NAME });
    const answer = yield* readTaskFile(userId, task.id, README).pipe(Effect.provide(github.layer));
    return { userId, answer: Option.getOrUndefined(answer), sent: github.sent };
  });

it.layer(getTestDB())("a task's file on the member's own token", (it) => {
  it.effect("is read from GitHub with the member's token as the documented Bearer header", () =>
    Effect.gen(function* () {
      const { answer, sent } = yield* readReadme(false);

      assert.ok(answer !== undefined && "file" in answer);
      assert.equal(answer.file.commit, HEAD);
      assert.equal(answer.file.lines.length, 1);
      const contents = sent.find((one) => one.url.includes("/contents/README.md"));
      assert.ok(contents);
      assert.equal(contents.headers.get("authorization"), `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`);
      assert.equal(contents.headers.get("accept"), "application/vnd.github+json");
      assert.equal(contents.headers.get("x-github-api-version"), "2022-11-28");
    }),
  );

  it.effect("a 401 on the read marks the member's token invalid", () =>
    Effect.gen(function* () {
      const { userId, answer } = yield* readReadme(true);
      const row = yield* readGitHubTokenRow(userId);

      assert.deepEqual(answer, { refusal: TASK_FILE_REFUSAL.UNAVAILABLE });
      assert.equal(row?.status, GITHUB_TOKEN_STATUS.INVALID);
    }),
  );
});
