import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CHANGED_FILE_STATUS, type CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import { Effect, Option, Redacted } from "effect";
import { githubReaching, type SentToGitHub } from "../testing/github-app-fake.js";
import { imageCommits } from "./pull-requests.js";

/**
 * image-commits.test.ts -- the commits a pull request's changed images are
 * read at, off a scripted GitHub: its head always, and where an image stood
 * before the pull request, the merge base one compare of its base and head
 * answers, asked for a single commit and file; no compare at all where no
 * image stood before, and no merge base where the compare does not land,
 * never the base branch's head in its place.
 */

const REPOSITORY = "acme/relay";
const TOKEN = Redacted.make("ghs_fixture_installation_token");
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGE_BASE = "c".repeat(40);
const COMPARE = `/repos/acme/relay/compare/${BASE}...${HEAD}`;

/** A changed file, modified unless told otherwise. */
function changed(
  path: string,
  status: CodingAgentChangedFile["status"] = CHANGED_FILE_STATUS.MODIFIED,
): CodingAgentChangedFile {
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

/** The image commits for `files`, GitHub's compare answering as `compare` says, and every request it was sent. */
const commitsOf = (files: readonly CodingAgentChangedFile[], compare: () => Response) =>
  Effect.gen(function* () {
    const sent: SentToGitHub[] = [];
    const github = githubReaching([], undefined, undefined, (request) => {
      sent.push(request);
      return new URL(request.url).pathname === COMPARE ? compare() : undefined;
    });
    const commits = yield* imageCommits(
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
  "a removed image needs the merge base too, and an added one or a text file asks no compare",
  () =>
    Effect.gen(function* () {
      const removed = yield* commitsOf(
        [changed("logo.svg", CHANGED_FILE_STATUS.DELETED)],
        mergeBase,
      );
      assert.equal(removed.commits.baseSha, MERGE_BASE);

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
