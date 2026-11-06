import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  PATCH_OMITTED,
} from "@repo/features/agent-wire";
import { Effect, Option, Redacted } from "effect";
import { githubReaching, type SentToGitHub } from "../testing/github-app-fake.js";
import { readCommits } from "./pull-requests.js";

const REPOSITORY = "acme/relay";
const TOKEN = Redacted.make("ghs_fixture_installation_token");
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGE_BASE = "c".repeat(40);
const COMPARE = `/repos/acme/relay/compare/${BASE}...${HEAD}`;

function changed(
  path: string,
  status: AgentChangedFile["status"] = CHANGED_FILE_STATUS.MODIFIED,
): AgentChangedFile {
  return {
    path,
    previousPath: null,
    status,
    additions: 0,
    deletions: 0,
    patch: null,
    omitted: null,
  };
}

const commitsOf = (files: readonly AgentChangedFile[], compare: () => Response) =>
  Effect.gen(function* () {
    const sent: SentToGitHub[] = [];
    const github = githubReaching([], undefined, undefined, (request) => {
      sent.push(request);
      return new URL(request.url).pathname === COMPARE ? compare() : undefined;
    });
    const commits = yield* readCommits(
      TOKEN,
      REPOSITORY,
      Option.some({ headSha: HEAD, baseSha: BASE }),
      files,
    ).pipe(Effect.provide(github.layer));
    return { commits, sent };
  });

const mergeBase = () => Response.json({ merge_base_commit: { sha: MERGE_BASE }, files: [] });

it.effect(
  "an image changed in place is read at the head and at the merge base one small compare answers",
  () =>
    Effect.gen(function* () {
      const { commits, sent } = yield* commitsOf([changed("docs/logo.png")], mergeBase);

      assert.deepEqual(commits, { headSha: HEAD, baseSha: MERGE_BASE });
      assert.equal(sent.length, 1);
      assert.equal(new URL(sent[0]?.url ?? "").searchParams.get("per_page"), "1");
    }),
);

it.effect(
  "a removed image or a text file too large to diff needs the merge base too, and an added one or a text file with a patch asks no compare",
  () =>
    Effect.gen(function* () {
      const removed = yield* commitsOf(
        [changed("logo.svg", CHANGED_FILE_STATUS.DELETED)],
        mergeBase,
      );
      assert.equal(removed.commits.baseSha, MERGE_BASE);

      const tooLarge = yield* commitsOf(
        [{ ...changed("PRIVACY.md"), omitted: PATCH_OMITTED.TOO_LARGE }],
        mergeBase,
      );
      assert.equal(tooLarge.commits.baseSha, MERGE_BASE);

      const added = yield* commitsOf(
        [changed("logo.png", CHANGED_FILE_STATUS.ADDED), changed("src/seats.ts")],
        mergeBase,
      );
      assert.deepEqual(added.commits, { headSha: HEAD });
      assert.equal(added.sent.length, 0);
    }),
);

it.effect("a compare that does not land names no merge base, never the base branch's head", () =>
  Effect.gen(function* () {
    const { commits } = yield* commitsOf([changed("docs/logo.png")], () =>
      Response.json({ message: "Server Error" }, { status: 500 }),
    );

    assert.deepEqual(commits, { headSha: HEAD });
  }),
);
