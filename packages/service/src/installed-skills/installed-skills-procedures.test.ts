import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { sessionInstalledSkills } from "@repo/database/models/installed-skill-store";
import { personalWorkspace } from "@repo/database/schemas/personal-workspace";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@repo/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH, installedSkillPath } from "@repo/features";
import {
  installedSkillContentSchema,
  installedSkillInstallAnswerSchema,
  installedSkillListAnswerSchema,
  installedSkillPreviewSchema,
  installedSkillRemovedAnswerSchema,
  SKILL_PASTE_KIND,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
} from "@repo/features/installed-skill-wire";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, type Context, Effect, Layer, Option, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import {
  recordingProductAnalytics,
  SERVER_EVENT,
  SERVER_SKILL_ACTION,
} from "../events/server-events.js";
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
  repositoryIdOf,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { installedSkillsProcedures } from "./installed-skills-procedures.js";

const ANALYTICS = recordingProductAnalytics();

const skillChangesCounted = (userId: string) =>
  ANALYTICS.recorded
    .filter((event) => event.userId === userId && event.name === SERVER_EVENT.SKILL_CHANGE)
    .map((event) => {
      assert.equal(event.workspaceId, undefined);
      return "action" in event.properties ? event.properties.action : undefined;
    });

const ORIGIN = "https://app.test";
const SKILLS = HOSTED_SERVICE_PATH.INSTALLED_SKILLS;

type Commit = Readonly<Record<string, string>>;

interface FakeRepository {
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  readonly branches: Map<string, string>;
  readonly commits: Map<string, Commit>;
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

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

function commitOf(repository: FakeRepository, ref: string): string | undefined {
  return (
    repository.branches.get(ref === "HEAD" ? "main" : ref) ??
    (repository.commits.has(ref) ? ref : undefined)
  );
}

function tarHeader(name: string, type: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  const put = (offset: number, value: string) => header.set(Buffer.from(value), offset);
  put(0, name);
  put(100, "0000644\0");
  put(124, `${size.toString(8).padStart(11, "0")}\0`);
  put(156, type);
  put(257, "ustar\0");
  return header;
}

function archiveOf(repository: FakeRepository, sha: string): Uint8Array<ArrayBuffer> {
  const tail = ` comment=${sha}\n`;
  let length = tail.length + 1;
  while (String(length).length + tail.length !== length)
    length = String(length).length + tail.length;
  const entries: [string, string, string][] = [
    ["pax_global_header", "g", `${length}${tail}`],
    ...Object.entries(repository.commits.get(sha) ?? {}).map(
      ([path, content]): [string, string, string] => [
        `${repository.name}-${sha}/${path}`,
        "0",
        content,
      ],
    ),
  ];
  const blocks = entries.flatMap(([name, type, content]) => {
    const body = Buffer.from(content);
    return [
      tarHeader(name, type, body.byteLength),
      body,
      new Uint8Array((512 - (body.byteLength % 512)) % 512),
    ];
  });
  return new Uint8Array(gzipSync(Buffer.concat([...blocks, new Uint8Array(1024)])));
}

function repositoryScript(repository: FakeRepository) {
  return (sent: SentToGitHub): Response | undefined => {
    const url = new URL(sent.url);
    const codeload = `/${repository.owner}/${repository.name}/tar.gz/`;
    if (url.host === "codeload.github.com" && url.pathname.startsWith(codeload)) {
      const sha = commitOf(repository, decodeURIComponent(url.pathname.slice(codeload.length)));
      return !repository.private && sha !== undefined
        ? new Response(archiveOf(repository, sha))
        : notFound();
    }
    const base = `/repos/${repository.owner}/${repository.name}`;
    if (!url.pathname.startsWith(base)) return undefined;
    const reached =
      !repository.private ||
      sent.headers.get("authorization") === `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`;
    if (!reached) return notFound();
    const rest = url.pathname.slice(base.length);
    if (rest === "") {
      return Response.json({
        id: repositoryIdOf(repository),
        name: repository.name,
        full_name: `${repository.owner}/${repository.name}`,
        owner: { login: repository.owner },
        default_branch: "main",
        private: repository.private,
        updated_at: null,
      });
    }
    const tarball = /^\/tarball\/(.+)$/u.exec(rest);
    const sha =
      tarball === null ? undefined : commitOf(repository, decodeURIComponent(tarball[1] ?? ""));
    return sha === undefined ? notFound() : new Response(archiveOf(repository, sha));
  };
}

function fakeRepository(owner: string, name: string, isPrivate = false): FakeRepository {
  return { owner, name, private: isPrivate, branches: new Map(), commits: new Map() };
}

let installationsMade = 0;

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
          ANALYTICS.layer,
          github.layer,
        ),
      ),
    );
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
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
  });

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

function sourcePreview(answer: Answer) {
  const previewed = readAnswer(installedSkillPreviewSchema, HOSTED_HTTP_STATUS.OK, answer);
  if (previewed.kind !== SKILL_PASTE_KIND.SOURCE) assert.fail(`not a source: ${previewed.kind}`);
  return previewed;
}

const FAKE_GITHUB_TOKEN = ["gh", "p_", "x".repeat(36)].join("");

const storedText = (userId: string, id: string, path: string) =>
  Effect.map(sessionInstalledSkills(userId, null), (skills) => {
    const file = skills.find((one) => one.id === id)?.files.find((one) => one.path === path);
    return file === undefined ? undefined : new TextDecoder().decode(file.bytes);
  });

it.layer(getTestDB())("the installed skills routes", (it) => {
  it.effect(
    "a public source lists its outermost skill folders at the commit its ref stands at, and an install reads that commit again",
    () =>
      Effect.gen(function* () {
        const kit = fakeRepository("acme", "kit");
        const review = skillFile("review", "Review a pull request.");
        const sha = commitTo(kit, "main", {
          "README.md": "# kit",
          "skills/review/SKILL.md": review,
          "skills/review/scripts/check.sh": "echo check",
          "skills/review/examples/SKILL.md": skillFile("example", "Part of review."),
          "skills/release/SKILL.md": skillFile("release", "Write release notes."),
          "vendor/review/SKILL.md": skillFile("review", "A second copy."),
          "node_modules/dep/SKILL.md": skillFile("dep", "A dependency's own."),
        });
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([], undefined, {}, repositoryScript(kit)));
        const paste = "npx skills add acme/kit --skill review";

        const previewed = sourcePreview(
          yield* ask(`${SKILLS}/preview`, owner, preview(workspace, paste)),
        );
        assert.equal(previewed.sha, sha);
        assert.deepEqual(
          previewed.skills.map(({ name, description, path, selected }) => ({
            name,
            description,
            path,
            selected,
          })),
          [
            {
              name: "release",
              description: "Write release notes.",
              path: "skills/release",
              selected: false,
            },
            {
              name: "review",
              description: "Review a pull request.",
              path: "skills/review",
              selected: true,
            },
          ],
        );

        commitTo(kit, "main", {
          ...kit.commits.get(sha),
          "skills/review/SKILL.md": skillFile("review", "Review a pull request, carefully."),
        });
        const [made] = readAnswer(
          installedSkillInstallAnswerSchema,
          201,
          yield* ask(
            SKILLS,
            owner,
            install({
              workspaceId: workspace,
              scope: INSTALLED_SKILL_SCOPE.PERSONAL,
              text: paste,
              skills: ["review"],
              sha,
            }),
          ),
        ).skills;
        assert.ok(made);
        assert.equal(made.description, "Review a pull request.");
        assert.deepEqual(made.source, {
          type: INSTALLED_SKILL_SOURCE.GITHUB,
          owner: "acme",
          repo: "kit",
          path: "skills/review",
          ref: "HEAD",
          sha,
        });
        assert.equal(yield* storedText(owner, made.id, "scripts/check.sh"), "echo check");
        assert.equal(
          yield* storedText(owner, made.id, "examples/SKILL.md"),
          skillFile("example", "Part of review."),
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
              text: "acme/pair",
              skills,
            }),
          );

        yield* installing(["beta"]);
        assert.deepEqual(yield* installing(["alpha", "beta"]), {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: { error: HOSTED_API_ERROR.SKILL_NAME_TAKEN, skillName: "beta" },
        });
        assert.equal((yield* installing(["gamma"])).status, HOSTED_HTTP_STATUS.BAD_REQUEST);

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
        const paste = "https://github.com/acme/vault";

        const reached = sourcePreview(
          yield* ask(`${SKILLS}/preview`, owner, preview(connected, paste)),
        );
        assert.equal(reached.ref, "main");
        assert.deepEqual(
          reached.skills.map(({ name, path, selected }) => ({ name, path, selected })),
          [{ name: "vault", path: "", selected: true }],
        );
        const unreached = { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE };
        assert.deepEqual(yield* ask(`${SKILLS}/preview`, owner, preview(bare, paste)), {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: unreached,
        });
        const strangers = yield* openGithubUser();
        const notMember = yield* ask(`${SKILLS}/preview`, strangers, preview(connected, paste));
        assert.equal(notMember.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.deepEqual(
          yield* ask(`${SKILLS}/preview`, owner, preview(connected, `${paste}/tree/nowhere`)),
          { status: HOSTED_HTTP_STATUS.FORBIDDEN, body: unreached },
        );
      }),
  );

  it.effect(
    "pasted text installs under the name and description given, written into its frontmatter, and text carrying a credential is refused",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const ask = yield* routes(githubReaching([]));
        const installText = (body: Record<string, unknown>) =>
          ask(
            SKILLS,
            owner,
            install({ workspaceId: workspace, scope: INSTALLED_SKILL_SCOPE.PERSONAL, ...body }),
          );
        const madeText = (body: Record<string, unknown>) =>
          Effect.gen(function* () {
            const [made] = readAnswer(
              installedSkillInstallAnswerSchema,
              201,
              yield* installText(body),
            ).skills;
            assert.ok(made);
            return { made, stored: yield* storedText(owner, made.id, "SKILL.md") };
          });
        const bare = "# My PR style\n\nLead with the change a user sees.";

        assert.deepEqual(
          readAnswer(
            installedSkillPreviewSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(`${SKILLS}/preview`, owner, preview(workspace, skillFile("tidy", "Tidy."))),
          ),
          {
            kind: SKILL_PASTE_KIND.TEXT,
            name: "tidy",
            description: "Tidy.",
            bytes: Buffer.byteLength(skillFile("tidy", "Tidy.").trim()),
            problems: [],
          },
        );
        assert.deepEqual((yield* installText({ text: bare })).body, {
          error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
          skillRefusal: INSTALLED_SKILL_REFUSAL.SKILL_FILE_INVALID,
        });

        const description = 'How PRs are written: "short", then the why.';
        const written = yield* madeText({ text: bare, name: "pr-style", description });
        assert.deepEqual(
          { name: written.made.name, description: written.made.description },
          { name: "pr-style", description },
        );
        assert.equal(
          written.stored,
          `---\nname: "pr-style"\ndescription: ${JSON.stringify(description)}\n---\n\n${bare}`,
        );

        const declared =
          "---\nname: declared\nuser-invocable: false\ndescription: >\n  Says its\n  own name.\n---\n\nBody.";
        const renamed = yield* madeText({ text: declared, name: "renamed" });
        assert.equal(renamed.made.userInvocable, false);
        assert.equal(
          renamed.stored,
          '---\nname: "renamed"\ndescription: "Says its own name."\nuser-invocable: false\n---\n\nBody.',
        );

        const leaky = skillFile("leaky", "Calls the API.", `export TOKEN=${FAKE_GITHUB_TOKEN}`);
        assert.deepEqual(yield* installText({ text: leaky }), {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: {
            error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
            skillName: "leaky",
            skillRefusal: INSTALLED_SKILL_REFUSAL.CREDENTIAL,
          },
        });
      }),
  );

  it.effect(
    "any member installs a workspace skill, which its installer and the owners and admins remove, every member reads, a personal workspace refuses, and strangers never see",
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

        const removing = (userId: string, id: string) =>
          ask(installedSkillPath(id), userId, { method: "DELETE" });
        assert.equal((yield* removing(peer, notes.id)).status, HOSTED_HTTP_STATUS.FORBIDDEN);
        const removed = readAnswer(
          installedSkillRemovedAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* removing(admin, notes.id),
        );
        assert.equal(removed.id, notes.id);
        assert.deepEqual(yield* seenBy(peer), [{ name: "team-style", manageable: false }]);
        assert.equal(
          (yield* ask(installedSkillPath("not-a-uuid"), owner, { method: "DELETE" })).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
        assert.deepEqual(skillChangesCounted(member), [SERVER_SKILL_ACTION.INSTALL]);
        assert.deepEqual(skillChangesCounted(admin), [
          SERVER_SKILL_ACTION.INSTALL,
          SERVER_SKILL_ACTION.REMOVE,
        ]);
        assert.deepEqual(skillChangesCounted(peer), []);
      }),
  );

  it.effect(
    "a read answers a skill's SKILL.md and every file's size to whoever may list it, and nothing to anyone else",
    () =>
      Effect.gen(function* () {
        const kit = fakeRepository("acme", "readable");
        commitTo(kit, "main", {
          "skills/review/SKILL.md": skillFile("review", "Review a pull request."),
          "skills/review/scripts/check.sh": "echo check",
        });
        const owner = yield* openGithubUser();
        const teammate = yield* openGithubUser();
        const stranger = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate, WORKSPACE_ROLE.MEMBER);
        const ask = yield* routes(githubReaching([], undefined, {}, repositoryScript(kit)));
        const installedAs = (scope: string, text: string, skills?: readonly string[]) =>
          Effect.map(
            ask(SKILLS, owner, install({ workspaceId: workspace, scope, text, skills })),
            (answer) => {
              const [made] = readAnswer(installedSkillInstallAnswerSchema, 201, answer).skills;
              assert.ok(made);
              return made.id;
            },
          );
        const own = yield* installedAs(INSTALLED_SKILL_SCOPE.PERSONAL, "acme/readable", ["review"]);
        const team = yield* installedAs(
          INSTALLED_SKILL_SCOPE.WORKSPACE,
          skillFile("team-style", "Shared with everyone."),
        );
        const read = (userId: string, id: string) => ask(installedSkillPath(id), userId);

        assert.deepEqual(
          readAnswer(installedSkillContentSchema, HOSTED_HTTP_STATUS.OK, yield* read(owner, own)),
          {
            id: own,
            skillFile: skillFile("review", "Review a pull request."),
            files: [
              {
                path: "SKILL.md",
                bytes: Buffer.byteLength(skillFile("review", "Review a pull request.")),
              },
              { path: "scripts/check.sh", bytes: Buffer.byteLength("echo check") },
            ],
          },
        );
        assert.equal(
          readAnswer(
            installedSkillContentSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* read(teammate, team),
          ).skillFile.trimEnd(),
          skillFile("team-style", "Shared with everyone.").trimEnd(),
          "a member reads a workspace skill they did not install",
        );
        assert.equal((yield* read(teammate, own)).status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal((yield* read(stranger, team)).status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal((yield* read(owner, "not-a-uuid")).status, HOSTED_HTTP_STATUS.NOT_FOUND);
      }),
  );
});
