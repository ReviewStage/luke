import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { Effect } from "effect";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { GitHubAccess, resolveRepository } from "../server/hosted/github-source";
import { createPlan } from "../server/hosted/plan-store";
import {
  REPOSITORY_READ_BOUNDS,
  REPOSITORY_READ_REFUSAL,
  REPOSITORY_READ_STATUS,
  type RepositoryReadResult,
  runGetFileContents,
} from "../server/hosted/repository-tools";
import type { PlanToolBinding } from "../server/hosted/update-plan-tool";
import {
  type FakeGitHub,
  type FakeRepository,
  fakeGitHub,
  RAW_DOWNLOAD_TOKEN,
} from "./support/github-fake";
import { noDatabase } from "./support/no-database";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model's source read, through the tool's public run over a
 * real dialect and a GitHub that answers at the process boundary: the
 * service's own MCP client speaks to a fake of GitHub's hosted repository
 * toolset, and its REST reads to a fake of GitHub's API, behind one `fetch`.
 * A plan is started the way the window starts one, its default branch
 * resolved to a commit under the account's connection, and every read after
 * that is made at that commit, from whichever account and repository the
 * plan names, whatever the model sends.
 *
 * Synthetic accounts, tokens, repositories, and source throughout.
 */

const COMMIT = {
  STARTED: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  MOVED_ON: "9a8b7c6d5e4f30211203f4e5d6c7b8a9f0e1d2c3",
  OTHER: "0123456789abcdef0123456789abcdef01234567",
} as const;

const TOKEN = {
  OWNER: "fixture-token-owner",
  OTHER: "fixture-token-other",
} as const;

const INVITES_AT_START = "export function invite(email: string) {}\n";
const INVITES_MOVED_ON = "export function invite(email: string, role: Role) {}\n";

/** A private repository whose default branch moves on after the plan starts. */
function relay(): FakeRepository {
  return {
    owner: "acme",
    name: "relay",
    private: true,
    defaultBranch: "main",
    branches: new Map([["main", COMMIT.STARTED]]),
    commits: new Map([
      [
        COMMIT.STARTED,
        new Map([
          ["README.md", { text: "# Relay\n" }],
          ["src/invites.ts", { text: INVITES_AT_START }],
          ["src/members/list.ts", { text: "export const list = [];\n" }],
          ["assets/logo.png", { binary: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }],
          ["data/dump.sql", { largeBytes: 5_000_000 }],
          ["src/generated.ts", { text: "x".repeat(REPOSITORY_READ_BOUNDS.MAX_FILE_CHARS + 10) }],
        ]),
      ],
      [
        COMMIT.MOVED_ON,
        new Map([
          ["README.md", { text: "# Relay\n" }],
          ["src/invites.ts", { text: INVITES_MOVED_ON }],
        ]),
      ],
    ]),
  };
}

/** Another account's repository, which the plan's account cannot read. */
function vault(): FakeRepository {
  return {
    owner: "rival",
    name: "vault",
    private: true,
    defaultBranch: "main",
    branches: new Map([["main", COMMIT.OTHER]]),
    commits: new Map([[COMMIT.OTHER, new Map([["secret.ts", { text: "export const s = 1;\n" }]])]]),
  };
}

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A plan started as the window starts one: the default branch resolved to a commit under the account's connection. */
const startPlan = (userId: string, repository: FakeRepository) =>
  Effect.gen(function* () {
    const github = yield* GitHubAccess;
    const token = yield* github.token(userId);
    const resolved = yield* resolveRepository(token, repository.owner, repository.name);
    const started = yield* createPlan(userId, {
      name: "Teammate invitations",
      repository: resolved,
    });
    return { userId, planId: started.id } satisfies PlanToolBinding;
  });

/** One account connected to `relay`, with a plan started on it. */
const openPlan = (github: FakeGitHub, repository: FakeRepository) =>
  Effect.gen(function* () {
    const userId = yield* openUser;
    github.connect(userId, TOKEN.OWNER, [repository]);
    return yield* startPlan(userId, repository);
  });

/** One tool call as the model would make it: its arguments are whatever JSON it emitted. */
const read = (binding: PlanToolBinding, input: WireBoundaryInput) =>
  runGetFileContents(binding, unparsedWire(input));

function fileContent(result: RepositoryReadResult): string {
  if (result.status !== REPOSITORY_READ_STATUS.FILE) {
    return assert.fail(`expected a file, got ${JSON.stringify(result)}`);
  }
  return result.content;
}

function notReadReason(result: RepositoryReadResult): string {
  if (result.status !== REPOSITORY_READ_STATUS.NOT_READ) {
    return assert.fail(`expected nothing read, got ${result.status}`);
  }
  return result.reason;
}

/** Nothing a result carries is a credential: not the connection's token, not a raw download token. */
function assertNoCredential(result: RepositoryReadResult) {
  const shown = JSON.stringify(result);
  for (const secret of [TOKEN.OWNER, TOKEN.OTHER, RAW_DOWNLOAD_TOKEN]) {
    assert.ok(!shown.includes(secret), `a result carried ${secret}`);
  }
}

it.layer(testSqlClient)("the get_file_contents tool", (it) => {
  it.effect("lists a private repository's directories with paths, repository, and commit", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());

      const root = yield* read(binding, { path: "" });
      const src = yield* read(binding, { path: "/src/" });

      assert.deepEqual(root, {
        status: REPOSITORY_READ_STATUS.DIRECTORY,
        repository: { owner: "acme", name: "relay" },
        commit: COMMIT.STARTED,
        path: "",
        entries: [
          { path: "README.md", type: "file", size: 8 },
          { path: "src", type: "dir", size: 0 },
          { path: "assets", type: "dir", size: 0 },
          { path: "data", type: "dir", size: 0 },
        ],
        truncated: false,
      });
      assert.deepEqual(
        src.status === REPOSITORY_READ_STATUS.DIRECTORY
          ? src.entries.map((entry) => [entry.path, entry.type])
          : src,
        [
          ["src/invites.ts", "file"],
          ["src/members", "dir"],
          ["src/generated.ts", "file"],
        ],
      );
      assertNoCredential(root);
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("reads a file's text with its path and the plan's commit", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());

      const invites = yield* read(binding, { path: "src/invites.ts" });

      assert.deepEqual(invites, {
        status: REPOSITORY_READ_STATUS.FILE,
        repository: { owner: "acme", name: "relay" },
        commit: COMMIT.STARTED,
        path: "src/invites.ts",
        content: INVITES_AT_START,
        characters: INVITES_AT_START.length,
        truncated: false,
      });
      assertNoCredential(invites);
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("keeps reading the commit the plan started at after the branch moves on", () => {
    const github = fakeGitHub();
    const repository = relay();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, repository);
      repository.branches.set("main", COMMIT.MOVED_ON);

      // A resumed conversation holds nothing but the binding; the commit is the plan's.
      const resumed = yield* read({ ...binding }, { path: "src/invites.ts" });
      const fresh = yield* startPlan(binding.userId, repository);
      const later = yield* read(fresh, { path: "src/invites.ts" });

      assert.equal(fileContent(resumed), INVITES_AT_START);
      assert.equal(
        resumed.status === REPOSITORY_READ_STATUS.FILE && resumed.commit,
        COMMIT.STARTED,
      );
      assert.equal(fileContent(later), INVITES_MOVED_ON);
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("refuses arguments that name a repository, an owner, a commit, or a way out", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());
      github.connect(`user-${randomUUID()}`, TOKEN.OTHER, [vault()]);

      const attempts: readonly WireBoundaryInput[] = [
        { path: "secret.ts", owner: "rival", repo: "vault" },
        { path: "src/invites.ts", sha: COMMIT.MOVED_ON },
        { path: "src/invites.ts", ref: "refs/heads/main" },
        { path: "../../rival/vault/contents/secret.ts" },
        { path: "src/./invites.ts" },
        { path: "src//invites.ts" },
        { path: "src/invites.ts?ref=main" },
        { path: "src%2F..%2Finvites.ts" },
        {},
      ];
      for (const attempt of attempts) {
        const result = yield* read(binding, attempt);
        assert.equal(
          notReadReason(result),
          REPOSITORY_READ_REFUSAL.UNREADABLE,
          JSON.stringify(attempt),
        );
      }
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("reads nothing for another account's plan, even with a connection of its own", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());
      const intruder = yield* openUser;
      github.connect(intruder, TOKEN.OTHER, [relay(), vault()]);
      const intruderPlan = yield* startPlan(intruder, vault());

      const borrowed = yield* read({ userId: intruder, planId: binding.planId }, { path: "" });
      const crossed = yield* read(
        { userId: binding.userId, planId: intruderPlan.planId },
        { path: "" },
      );

      assert.equal(notReadReason(borrowed), REPOSITORY_READ_REFUSAL.NO_PLAN);
      assert.equal(notReadReason(crossed), REPOSITORY_READ_REFUSAL.NO_PLAN);
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("says nothing was read when the connection is revoked or loses the repository", () => {
    const github = fakeGitHub();
    const repository = relay();
    return Effect.gen(function* () {
      const revoked = yield* openPlan(github, repository);
      github.revoke(TOKEN.OWNER);
      const afterRevoke = yield* read(revoked, { path: "src/invites.ts" });

      const withdrawn = yield* openPlan(github, repository);
      github.withdraw(TOKEN.OWNER, repository);
      const afterWithdraw = yield* read(withdrawn, { path: "src/invites.ts" });

      assert.equal(notReadReason(afterRevoke), REPOSITORY_READ_REFUSAL.ACCESS_DENIED);
      assert.equal(notReadReason(afterWithdraw), REPOSITORY_READ_REFUSAL.NOT_FOUND);
      assert.equal(
        afterRevoke.status === REPOSITORY_READ_STATUS.NOT_READ && afterRevoke.commit,
        COMMIT.STARTED,
      );
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("says the account has no GitHub connection when it has none", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());
      const disconnected = fakeGitHub();

      const result = yield* read(binding, { path: "" }).pipe(Effect.provide(disconnected.layer));

      assert.equal(notReadReason(result), REPOSITORY_READ_REFUSAL.NOT_CONNECTED);
    }).pipe(Effect.provide(github.layer));
  });

  it.effect(
    "keeps binary, oversized, and missing files explicit, without GitHub's download links",
    () => {
      const github = fakeGitHub();
      return Effect.gen(function* () {
        const binding = yield* openPlan(github, relay());

        const logo = yield* read(binding, { path: "assets/logo.png" });
        const dump = yield* read(binding, { path: "data/dump.sql" });
        const missing = yield* read(binding, { path: "members/list.ts" });
        const nowhere = yield* read(binding, { path: "nothing/here.ts" });

        assert.equal(notReadReason(logo), REPOSITORY_READ_REFUSAL.BINARY);
        assert.equal(notReadReason(dump), REPOSITORY_READ_REFUSAL.TOO_LARGE);
        assert.equal(notReadReason(missing), REPOSITORY_READ_REFUSAL.NOT_FOUND);
        assert.deepEqual(
          missing.status === REPOSITORY_READ_STATUS.NOT_READ && missing.suggestions,
          ["src/members/list.ts"],
        );
        assert.equal(notReadReason(nowhere), REPOSITORY_READ_REFUSAL.NOT_FOUND);
        for (const result of [logo, dump, missing, nowhere]) assertNoCredential(result);
      }).pipe(Effect.provide(github.layer));
    },
  );

  it.effect("cuts a long file at the bound and says so", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());

      const generated = yield* read(binding, { path: "src/generated.ts" });

      assert.equal(fileContent(generated).length, REPOSITORY_READ_BOUNDS.MAX_FILE_CHARS);
      assert.deepEqual(
        generated.status === REPOSITORY_READ_STATUS.FILE && [
          generated.truncated,
          generated.characters,
        ],
        [true, REPOSITORY_READ_BOUNDS.MAX_FILE_CHARS + 10],
      );
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("cuts a long directory at the bound and says so", () => {
    const github = fakeGitHub();
    const crowded = relay();
    const files = new Map(
      Array.from({ length: REPOSITORY_READ_BOUNDS.MAX_DIRECTORY_ENTRIES + 1 }, (_, index) => [
        `gen/f${index}.ts`,
        { text: "" },
      ]),
    );
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, {
        ...crowded,
        commits: new Map([[COMMIT.STARTED, files]]),
      });

      const listing = yield* read(binding, { path: "gen" });

      assert.deepEqual(
        listing.status === REPOSITORY_READ_STATUS.DIRECTORY && [
          listing.entries.length,
          listing.truncated,
        ],
        [REPOSITORY_READ_BOUNDS.MAX_DIRECTORY_ENTRIES, true],
      );
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("says the store was unreachable when the plan cannot be read", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());

      const result = yield* read(binding, { path: "" }).pipe(Effect.provide(noDatabase));

      assert.equal(notReadReason(result), REPOSITORY_READ_REFUSAL.STORE_UNAVAILABLE);
    }).pipe(Effect.provide(github.layer));
  });

  it.effect("says GitHub failed when the hosted service does", () => {
    const github = fakeGitHub();
    return Effect.gen(function* () {
      const binding = yield* openPlan(github, relay());
      github.breakMcp(502);

      const result = yield* read(binding, { path: "README.md" });

      assert.equal(notReadReason(result), REPOSITORY_READ_REFUSAL.FAILED);
    }).pipe(Effect.provide(github.layer));
  });
});
