import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { readInstalledSkill } from "@luke/database/models/installed-skill-store";
import { personalWorkspace } from "@luke/database/schemas/personal-workspace";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@luke/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH, installedSkillPath } from "@luke/features";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  installedSkillAnswerSchema,
  installedSkillInstallAnswerSchema,
  installedSkillListAnswerSchema,
  installedSkillPreviewSchema,
  installedSkillUpdateCheckSchema,
  installedSkillUpdatedAnswerSchema,
} from "@luke/features/installed-skill-route-wire";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import { SKILL_PASTE_KIND } from "@luke/features/skill-paste";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, type Context, Effect, Layer, Option, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import type { GitHubApp } from "../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { installedSkillsProcedures } from "./installed-skills-procedures.js";

/**
 * The installed skills routes, answered by the hosted oRPC router the way
 * the web route answers them, over PGlite and a GitHub that answers from a
 * repository the test lays out commit by commit: a paste previewed and
 * installed, its files pinned to the commit its ref stood at, read on the
 * workspace's installation for a private repository and anonymously for a
 * public one; text made a one-file skill; a skill refused for its bounds,
 * its convention, or a credential; each scope's permissions; and an update
 * offered only when the skill's own folder moved. Synthetic accounts,
 * repositories, and words throughout.
 */

const ORIGIN = "https://luke.test";
const SKILLS = HOSTED_SERVICE_PATH.INSTALLED_SKILLS;

/** One commit of a fake repository: every file by its path from the root. */
type Commit = Readonly<Record<string, string>>;

/** A repository the fake GitHub answers for, its branches moved by the test. */
interface FakeRepository {
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  readonly branches: Map<string, string>;
  readonly commits: Map<string, Commit>;
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

/** A commit added to the repository and the branch moved to it; its sha. */
function commitTo(repository: FakeRepository, branch: string, files: Commit): string {
  const sha = sha1(`${repository.commits.size}:${JSON.stringify(files)}`);
  repository.commits.set(sha, files);
  repository.branches.set(branch, sha);
  return sha;
}

function skillFile(name: string, description: string, body = "Do the thing."): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`;
}

const notFound = () => Response.json({ message: "Not Found" }, { status: 404 });

/** The commit a ref names: a branch, or a commit's own sha. */
function commitOf(repository: FakeRepository, ref: string): string | undefined {
  return repository.branches.get(ref) ?? (repository.commits.has(ref) ? ref : undefined);
}

/** The tree of the folder at the commit as the git trees API answers it, every entry under it where recursive. */
function treeAnswer(files: Commit, folder: string, recursive: boolean): Response {
  const prefix = folder === "" ? "" : `${folder}/`;
  const under = Object.entries(files).filter(([path]) => path.startsWith(prefix));
  if (under.length === 0) return notFound();
  const entries = new Map<string, { path: string; type: string; size?: number }>();
  for (const [path, content] of under) {
    const rest = path.slice(prefix.length);
    const segments = rest.split("/");
    const shown = recursive ? segments.length : 1;
    for (let depth = 1; depth < Math.min(segments.length, shown + 1); depth += 1) {
      const dir = segments.slice(0, depth).join("/");
      entries.set(dir, { path: dir, type: "tree" });
    }
    if (recursive || segments.length === 1) {
      entries.set(rest, { path: rest, type: "blob", size: Buffer.byteLength(content) });
    }
  }
  return Response.json({
    sha: sha1(JSON.stringify(under)),
    tree: [...entries.values()],
    truncated: false,
  });
}

/**
 * The repository's paths as GitHub answers them: the repository itself
 * (anonymously too where it is public), a ref's commit, a tree, and a
 * file's contents; a private one answers only the installation's token.
 */
function repositoryScript(repository: FakeRepository) {
  return (sent: SentToGitHub): Response | undefined => {
    const url = new URL(sent.url);
    const base = `/repos/${repository.owner}/${repository.name}`;
    if (!url.pathname.startsWith(base)) return undefined;
    const reached =
      !repository.private ||
      sent.headers.get("authorization") === `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`;
    if (!reached) return notFound();
    const rest = url.pathname.slice(base.length);
    if (rest === "") {
      return Response.json({
        name: repository.name,
        full_name: `${repository.owner}/${repository.name}`,
        owner: { login: repository.owner },
        default_branch: "main",
        private: repository.private,
      });
    }
    const commit = /^\/commits\/(.+)$/u.exec(rest);
    if (commit !== null) {
      const sha = commitOf(repository, decodeURIComponent(commit[1] ?? ""));
      return sha === undefined ? Response.json({}, { status: 422 }) : Response.json({ sha });
    }
    const tree = /^\/git\/trees\/(.+)$/u.exec(rest);
    if (tree !== null) {
      const treeish = decodeURIComponent(tree[1] ?? "");
      const [ref = "", folder = ""] = treeish.split(":");
      const files = repository.commits.get(commitOf(repository, ref) ?? "");
      if (files === undefined) return notFound();
      return treeAnswer(files, folder, url.searchParams.get("recursive") === "1");
    }
    const contents = /^\/contents\/(.+)$/u.exec(rest);
    if (contents !== null) {
      const path = (contents[1] ?? "").split("/").map(decodeURIComponent).join("/");
      const files = repository.commits.get(
        commitOf(repository, url.searchParams.get("ref") ?? "") ?? "",
      );
      const content = files?.[path];
      if (content === undefined) return notFound();
      return Response.json({
        type: "file",
        size: Buffer.byteLength(content),
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      });
    }
    return notFound();
  };
}

function fakeRepository(owner: string, name: string, isPrivate = false): FakeRepository {
  return { owner, name, private: isPrivate, branches: new Map(), commits: new Map() };
}

let installationsMade = 0;

/** An installation of its own for a test, on the repository's owner. */
function installationFor(repository: FakeRepository): InstallationFixture {
  installationsMade += 1;
  return {
    id: 9_000 + installationsMade,
    login: repository.owner,
    accountId: 90_000 + installationsMade,
    repositories: [{ owner: repository.owner, name: repository.name, private: repository.private }],
  };
}

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The procedures over the test's database and the GitHub given, every account its own bearer. */
const routes = (github: FakeGitHub) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<
      DatabaseServices | GitHubApp | HttpClient.HttpClient
    >().pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
          Layer.succeed(Database, yield* Database),
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
          github.layer,
        ),
      ),
    );
    // SAFETY: the procedures yield the database, the clock, GitHub, and its HTTP client alone, which is all this provides of the web runtime's services.
    const webServices = services as Context.Context<WebServices>;
    const handle = hostedFetch({
      installedSkills: installedSkillsProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(
              incoming.headers.get("authorization")?.replace(/^Bearer /u, "") || undefined,
            ),
          ),
      }),
    });
    return (path: string, userId: string, init: { method?: string; body?: unknown } = {}) =>
      Effect.gen(function* () {
        const sent = init.body === undefined ? undefined : JSON.stringify(init.body);
        const response = yield* Effect.promise(() =>
          handle(
            new Request(`${ORIGIN}${path}`, {
              method: init.method ?? "GET",
              headers: { "content-type": "application/json", authorization: `Bearer ${userId}` },
              ...(sent === undefined ? undefined : { body: sent }),
            }),
            webServices,
          ),
        );
        const text = yield* Effect.promise(() => response.text());
        // SAFETY: the router answers JSON; the test reads it as the wire value it is.
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
  });

/** The answer read through its schema, failing the test where the status or the body is not what it should be. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answer: Answer,
): S["Type"] {
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  const read = readEither(schema)(unparsedWire(answer.body));
  if (Result.isFailure(read)) assert.fail(`not the answer: ${JSON.stringify(answer.body)}`);
  return read.success;
}

const install = (body: Record<string, unknown>) => ({ method: "POST", body });
const preview = (workspaceId: string, text: string) => ({
  method: "POST",
  body: { workspaceId, text },
});

/** A credential-shaped literal, built at run time so no tracked file holds one (`scripts/repository-checks.sh`). */
const FAKE_GITHUB_TOKEN = ["gh", "p_", "x".repeat(36)].join("");

/** The text of a stored skill's file. */
const storedText = (userId: string, id: string, path: string) =>
  Effect.map(readInstalledSkill(userId, id), (skill) => {
    const file = Option.getOrUndefined(skill)?.files.find((one) => one.path === path);
    return file === undefined ? undefined : new TextDecoder().decode(file.bytes);
  });

it.layer(getTestDB())("the installed skills routes", (it) => {
  it.effect(
    "a public source previews every skill folder pinned to its commit, and installs the ones asked with their files",
    () =>
      Effect.gen(function* () {
        const kit = fakeRepository("acme", "kit");
        const sha = commitTo(kit, "main", {
          "README.md": "# kit",
          "skills/review/SKILL.md": skillFile("review", "Review a pull request."),
          "skills/review/scripts/check.sh": "echo check",
          "skills/release/SKILL.md": skillFile("release", "Write release notes."),
          ".claude/skills/review/SKILL.md": skillFile("review", "A shadowed copy."),
        });
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([], undefined, {}, repositoryScript(kit)));

        const previewed = readAnswer(
          installedSkillPreviewSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            `${SKILLS}/preview`,
            owner,
            preview(workspace, "npx skills add acme/kit --skill review -s nope"),
          ),
        );
        assert.equal(previewed.kind, SKILL_PASTE_KIND.SOURCE);
        if (previewed.kind !== SKILL_PASTE_KIND.SOURCE) return;
        assert.equal(previewed.sha, sha);
        assert.equal(previewed.ref, "main");
        assert.deepEqual(previewed.missing, ["nope"]);
        assert.deepEqual(
          previewed.skills.map(({ name, path, fileCount, selected, problems }) => ({
            name,
            path,
            fileCount,
            selected,
            problems,
          })),
          [
            {
              name: "release",
              path: "skills/release",
              fileCount: 1,
              selected: false,
              problems: [],
            },
            { name: "review", path: "skills/review", fileCount: 2, selected: true, problems: [] },
          ],
        );

        // A moved branch after the preview is read afresh: the install pins the commit it stands at then.
        const later = commitTo(kit, "main", {
          ...kit.commits.get(sha),
          "skills/review/SKILL.md": skillFile("review", "Review a pull request, carefully."),
        });
        const installed = readAnswer(
          installedSkillInstallAnswerSchema,
          201,
          yield* ask(
            SKILLS,
            owner,
            install({
              workspaceId: workspace,
              scope: INSTALLED_SKILL_SCOPE.PERSONAL,
              text: "npx skills add acme/kit --skill review",
            }),
          ),
        ).skills;
        assert.equal(installed.length, 1);
        const [review] = installed;
        assert.ok(review);
        assert.equal(review.description, "Review a pull request, carefully.");
        assert.deepEqual(review.source, {
          type: INSTALLED_SKILL_SOURCE.GITHUB,
          owner: "acme",
          repo: "kit",
          path: "skills/review",
          ref: "main",
          sha: later,
        });
        assert.equal(yield* storedText(owner, review.id, "scripts/check.sh"), "echo check");

        const listed = readAnswer(
          installedSkillListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${SKILLS}?workspaceId=${workspace}`, owner),
        );
        assert.deepEqual(
          listed.skills.map(({ name, manageable, enabled }) => ({ name, manageable, enabled })),
          [{ name: "review", manageable: true, enabled: true }],
        );
      }),
  );

  it.effect(
    "a name already installed is refused by name, and an install of several that meets one installs none",
    () =>
      Effect.gen(function* () {
        const kit = fakeRepository("acme", "pair");
        commitTo(kit, "main", {
          "skills/alpha/SKILL.md": skillFile("alpha", "First."),
          "skills/beta/SKILL.md": skillFile("beta", "Second."),
        });
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([], undefined, {}, repositoryScript(kit)));
        const installing = (skills: readonly string[]) =>
          ask(
            SKILLS,
            owner,
            install({
              workspaceId: workspace,
              scope: INSTALLED_SKILL_SCOPE.PERSONAL,
              text: "npx skills add acme/pair",
              skills,
            }),
          );

        yield* installing(["beta"]);
        const again = yield* installing(["alpha", "beta"]);
        assert.deepEqual(again, {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: { error: HOSTED_API_ERROR.SKILL_NAME_TAKEN, skillName: "beta" },
        });
        const notInRepository = yield* installing(["gamma"]);
        assert.equal(notInRepository.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        // With several skills and none chosen, the paste asks for none.
        const unchosen = yield* ask(
          SKILLS,
          owner,
          install({
            workspaceId: workspace,
            scope: INSTALLED_SKILL_SCOPE.PERSONAL,
            text: "npx skills add acme/pair",
          }),
        );
        assert.equal(unchosen.status, HOSTED_HTTP_STATUS.BAD_REQUEST);

        const listed = readAnswer(
          installedSkillListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${SKILLS}?workspaceId=${workspace}`, owner),
        );
        assert.deepEqual(
          listed.skills.map((skill) => skill.name),
          ["beta"],
        );
      }),
  );

  it.effect(
    "a private repository is read on the workspace's installation, and is out of reach of a workspace without one",
    () =>
      Effect.gen(function* () {
        const vault = fakeRepository("acme", "vault", true);
        commitTo(vault, "main", { "SKILL.md": skillFile("vault", "The vault's one skill.") });
        const installation = installationFor(vault);
        const owner = yield* openGithubUser();
        const connected = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(connected, installation);
        const bare = yield* openWorkspace(owner);
        const ask = yield* routes(
          githubReaching([installation], undefined, {}, repositoryScript(vault)),
        );
        const paste = "npx skills add https://github.com/acme/vault";

        const reached = readAnswer(
          installedSkillPreviewSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${SKILLS}/preview`, owner, preview(connected, paste)),
        );
        assert.ok(reached.kind === SKILL_PASTE_KIND.SOURCE);
        assert.deepEqual(
          reached.skills.map(({ name, path, selected }) => ({ name, path, selected })),
          [{ name: "vault", path: "", selected: true }],
        );
        const unreached = yield* ask(`${SKILLS}/preview`, owner, preview(bare, paste));
        assert.deepEqual(unreached, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE },
        });
        const strangers = yield* openGithubUser();
        const notMember = yield* ask(`${SKILLS}/preview`, strangers, preview(connected, paste));
        assert.equal(notMember.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        const missingRef = yield* ask(
          `${SKILLS}/preview`,
          owner,
          preview(connected, "npx skills add https://github.com/acme/vault/tree/nowhere"),
        );
        assert.equal(missingRef.status, HOSTED_HTTP_STATUS.CONFLICT);
        assert.deepEqual(missingRef.body, { error: HOSTED_API_ERROR.BRANCH_NOT_FOUND });
      }),
  );

  it.effect(
    "pasted text becomes a one-file skill with the name and description it lacked written in, and text carrying a credential is refused",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([]));
        const bare = "# My PR style\n\nLead with the change a user sees.";

        const previewed = readAnswer(
          installedSkillPreviewSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${SKILLS}/preview`, owner, preview(workspace, bare)),
        );
        assert.deepEqual(previewed, {
          kind: SKILL_PASTE_KIND.TEXT,
          name: "my-pr-style",
          bytes: Buffer.byteLength(bare),
          problems: [INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING],
        });
        const undescribed = yield* ask(
          SKILLS,
          owner,
          install({ workspaceId: workspace, scope: INSTALLED_SKILL_SCOPE.PERSONAL, text: bare }),
        );
        assert.deepEqual(undescribed.body, {
          error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
          skillName: "my-pr-style",
          skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_INVALID,
        });

        const description = 'How PRs are written: "short", then the why.';
        const [made] = readAnswer(
          installedSkillInstallAnswerSchema,
          201,
          yield* ask(
            SKILLS,
            owner,
            install({
              workspaceId: workspace,
              scope: INSTALLED_SKILL_SCOPE.PERSONAL,
              text: bare,
              description,
            }),
          ),
        ).skills;
        assert.ok(made);
        assert.deepEqual(
          { name: made.name, description: made.description, source: made.source },
          { name: "my-pr-style", description, source: { type: INSTALLED_SKILL_SOURCE.TEXT } },
        );
        assert.equal(
          yield* storedText(owner, made.id, "SKILL.md"),
          `---\nname: "my-pr-style"\ndescription: ${JSON.stringify(description)}\n---\n\n${bare}`,
        );

        // A name the text declares is the text's: another is no request.
        const renamed = yield* ask(
          SKILLS,
          owner,
          install({
            workspaceId: workspace,
            scope: INSTALLED_SKILL_SCOPE.PERSONAL,
            text: skillFile("declared", "Says its own name."),
            name: "other",
          }),
        );
        assert.equal(renamed.status, HOSTED_HTTP_STATUS.BAD_REQUEST);

        const leaky = skillFile("leaky", "Calls the API.", `export TOKEN=${FAKE_GITHUB_TOKEN}`);
        const leakyPreview = readAnswer(
          installedSkillPreviewSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${SKILLS}/preview`, owner, preview(workspace, leaky)),
        );
        assert.ok(leakyPreview.kind === SKILL_PASTE_KIND.TEXT);
        assert.deepEqual(leakyPreview.problems, [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED]);
        const leaked = yield* ask(
          SKILLS,
          owner,
          install({ workspaceId: workspace, scope: INSTALLED_SKILL_SCOPE.PERSONAL, text: leaky }),
        );
        assert.deepEqual(leaked, {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: {
            error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
            skillName: "leaky",
            skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED,
          },
        });
      }),
  );

  it.effect(
    "a skill folder past a skill's bounds, or holding a credential in any file, previews its problem and installs nothing",
    () =>
      Effect.gen(function* () {
        const big = fakeRepository("acme", "big");
        const many = Object.fromEntries(
          Array.from({ length: 64 }, (_, index) => [`skills/many/notes/${index}.md`, "note"]),
        );
        commitTo(big, "main", {
          "skills/many/SKILL.md": skillFile("many", "Too many files."),
          ...many,
          "skills/leaky/SKILL.md": skillFile("leaky", "Ships a key."),
          "skills/leaky/env.sh": `export TOKEN=${FAKE_GITHUB_TOKEN}`,
        });
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([], undefined, {}, repositoryScript(big)));

        const previewed = readAnswer(
          installedSkillPreviewSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            `${SKILLS}/preview`,
            owner,
            preview(workspace, "npx skills add acme/big --all"),
          ),
        );
        assert.ok(previewed.kind === SKILL_PASTE_KIND.SOURCE);
        assert.deepEqual(
          previewed.skills.map(({ name, problems }) => ({ name, problems })),
          [
            { name: "leaky", problems: [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED] },
            { name: "many", problems: [INSTALLED_SKILL_PROBLEM.TOO_MANY_FILES] },
          ],
        );
        const installing = (skill: string) =>
          ask(
            SKILLS,
            owner,
            install({
              workspaceId: workspace,
              scope: INSTALLED_SKILL_SCOPE.PERSONAL,
              text: `npx skills add acme/big@${skill}`,
            }),
          );
        assert.deepEqual((yield* installing("many")).body, {
          error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
          skillName: "many",
          skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.TOO_MANY_FILES,
        });
        assert.deepEqual((yield* installing("leaky")).body, {
          error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
          skillName: "leaky",
          skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED,
        });
      }),
  );

  it.effect(
    "a name two roots hold stands as the first copy that installs, a broken copy before it set aside",
    () =>
      Effect.gen(function* () {
        const kit = fakeRepository("acme", "shadow");
        commitTo(kit, "main", {
          "skills/review/SKILL.md": "---\nname: review\n---\n\nNo description.",
          ".agents/skills/review/SKILL.md": skillFile("review", "The copy that installs."),
        });
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([], undefined, {}, repositoryScript(kit)));

        const previewed = readAnswer(
          installedSkillPreviewSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${SKILLS}/preview`, owner, preview(workspace, "npx skills add acme/shadow")),
        );
        assert.ok(previewed.kind === SKILL_PASTE_KIND.SOURCE);
        assert.deepEqual(
          previewed.skills.map(({ name, path, selected, problems }) => ({
            name,
            path,
            selected,
            problems,
          })),
          [{ name: "review", path: ".agents/skills/review", selected: true, problems: [] }],
        );
      }),
  );

  it.effect(
    "any member installs a workspace skill, which its installer and the owners and admins manage, every member reads, a personal workspace refuses, and strangers never see",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const admin = yield* openGithubUser();
        const member = yield* openGithubUser();
        const peer = yield* openGithubUser();
        const stranger = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, admin, WORKSPACE_ROLE.ADMIN);
        yield* joinWorkspace(workspace, member, WORKSPACE_ROLE.MEMBER);
        yield* joinWorkspace(workspace, peer, WORKSPACE_ROLE.MEMBER);
        const personal = yield* openWorkspace(owner);
        yield* Database.use((db) =>
          db
            .insert(personalWorkspace)
            .values({ userId: owner, organizationId: personal, createdAt: new Date(0) }),
        );
        const ask = yield* routes(githubReaching([]));
        const shared = (by: string, workspaceId: string, name: string) =>
          ask(
            SKILLS,
            by,
            install({
              workspaceId,
              scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
              text: skillFile(name, "Shared with everyone."),
            }),
          );
        const installedBy = (by: string, name: string) =>
          Effect.map(shared(by, workspace, name), (answer) => {
            const [made] = readAnswer(installedSkillInstallAnswerSchema, 201, answer).skills;
            assert.ok(made);
            return made;
          });

        assert.equal(
          (yield* shared(owner, personal, "mine")).status,
          HOSTED_HTTP_STATUS.BAD_REQUEST,
        );
        assert.equal(
          (yield* shared(stranger, workspace, "nope")).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
        const team = yield* installedBy(admin, "team-style");
        const notes = yield* installedBy(member, "member-notes");
        assert.deepEqual(
          [team, notes].map(({ workspaceId, installedBy }) => ({ workspaceId, installedBy })),
          [
            { workspaceId: workspace, installedBy: admin },
            { workspaceId: workspace, installedBy: member },
          ],
        );

        const seenBy = (userId: string) =>
          Effect.map(ask(`${SKILLS}?workspaceId=${workspace}`, userId), (answer) =>
            readAnswer(installedSkillListAnswerSchema, HOSTED_HTTP_STATUS.OK, answer).skills.map(
              ({ name, manageable }) => ({ name, manageable }),
            ),
          );
        assert.deepEqual(yield* seenBy(member), [
          { name: "member-notes", manageable: true },
          { name: "team-style", manageable: false },
        ]);
        assert.deepEqual(yield* seenBy(peer), [
          { name: "member-notes", manageable: false },
          { name: "team-style", manageable: false },
        ]);
        assert.deepEqual(yield* seenBy(owner), [
          { name: "member-notes", manageable: true },
          { name: "team-style", manageable: true },
        ]);
        assert.equal(
          (yield* ask(`${SKILLS}?workspaceId=${workspace}`, stranger)).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );

        const toggle = (userId: string, id: string, enabled: boolean) =>
          ask(installedSkillPath(id), userId, { method: "PATCH", body: { enabled } });
        assert.equal((yield* toggle(peer, notes.id, false)).status, HOSTED_HTTP_STATUS.FORBIDDEN);
        assert.equal((yield* toggle(member, team.id, false)).status, HOSTED_HTTP_STATUS.FORBIDDEN);
        assert.equal(
          (yield* toggle(stranger, notes.id, false)).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
        const off = readAnswer(
          installedSkillAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* toggle(member, notes.id, false),
        ).skill;
        assert.equal(off.enabled, false);

        const removing = (userId: string, id: string) =>
          ask(installedSkillPath(id), userId, { method: "DELETE" });
        assert.equal((yield* removing(peer, notes.id)).status, HOSTED_HTTP_STATUS.FORBIDDEN);
        assert.deepEqual(yield* removing(admin, notes.id), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { id: notes.id },
        });
        assert.deepEqual(yield* seenBy(peer), [{ name: "team-style", manageable: false }]);
        assert.equal(
          (yield* ask(installedSkillPath("not-a-uuid"), owner, { method: "DELETE" })).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
      }),
  );

  it.effect(
    "an update is offered only once the skill's own folder moved at its ref, and an update pins the new commit",
    () =>
      Effect.gen(function* () {
        const kit = fakeRepository("acme", "moving");
        const first = commitTo(kit, "main", {
          "skills/notes/SKILL.md": skillFile("notes", "Take notes."),
          "README.md": "one",
        });
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([], undefined, {}, repositoryScript(kit)));
        const [skill] = readAnswer(
          installedSkillInstallAnswerSchema,
          201,
          yield* ask(
            SKILLS,
            owner,
            install({
              workspaceId: workspace,
              scope: INSTALLED_SKILL_SCOPE.PERSONAL,
              text: "npx skills add acme/moving",
            }),
          ),
        ).skills;
        assert.ok(skill);
        const check = Effect.map(
          ask(`${installedSkillPath(skill.id)}/update?workspaceId=${workspace}`, owner),
          (answer) => readAnswer(installedSkillUpdateCheckSchema, HOSTED_HTTP_STATUS.OK, answer),
        );

        assert.deepEqual(yield* check, { available: false, latestSha: first });
        const elsewhere = commitTo(kit, "main", { ...kit.commits.get(first), "README.md": "two" });
        assert.deepEqual(yield* check, { available: false, latestSha: elsewhere });
        const moved = commitTo(kit, "main", {
          ...kit.commits.get(elsewhere),
          "skills/notes/SKILL.md": skillFile("notes", "Take better notes."),
        });
        assert.deepEqual(yield* check, { available: true, latestSha: moved });

        const updated = readAnswer(
          installedSkillUpdatedAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${installedSkillPath(skill.id)}/update`, owner, {
            method: "POST",
            body: { workspaceId: workspace },
          }),
        );
        assert.equal(updated.changed, true);
        assert.equal(updated.skill.description, "Take better notes.");
        assert.ok(updated.skill.source.type === INSTALLED_SKILL_SOURCE.GITHUB);
        assert.equal(updated.skill.source.sha, moved);
        assert.deepEqual(yield* check, { available: false, latestSha: moved });

        // An update keeps the skill's name, so a `SKILL.md` that now names another is refused.
        commitTo(kit, "main", {
          ...kit.commits.get(moved),
          "skills/notes/SKILL.md": skillFile("journal", "Renamed upstream."),
        });
        const renamed = yield* ask(`${installedSkillPath(skill.id)}/update`, owner, {
          method: "POST",
          body: { workspaceId: workspace },
        });
        assert.deepEqual(renamed, {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: {
            error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
            skillName: "notes",
            skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.SKILL_FILE_INVALID,
          },
        });

        const other = yield* openGithubUser();
        yield* joinWorkspace(workspace, other, WORKSPACE_ROLE.MEMBER);
        const notTheirs = yield* ask(`${installedSkillPath(skill.id)}/update`, other, {
          method: "POST",
          body: { workspaceId: workspace },
        });
        assert.equal(notTheirs.status, HOSTED_HTTP_STATUS.NOT_FOUND);
      }),
  );
});
