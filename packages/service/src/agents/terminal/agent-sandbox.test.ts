import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import { Effect, Layer, Redacted, Result } from "effect";
import { afterEach, vi } from "vitest";
import { LOCAL_AGENT_ENVIRONMENT } from "../../testing/local-agent.js";
import { runnerSandboxApi } from "../../testing/runner-sandbox-fake.js";
import {
  commandRunStreamed,
  fixtureToken,
  sandboxesListed,
  sandboxFetchOver,
  sandboxFound,
  sandboxListRefusal,
  sessionAnswered,
} from "../../testing/vercel-sandbox-fake.js";
import { openAgentSandbox } from "../agent-sandbox-open.js";
import { AgentImage } from "../coder-host/agent-image.js";
import { SandboxUnavailable, vercelSandboxApi } from "../vercel-sandbox-api.js";
import { AgentSandbox, agentSandboxLayer, SHELL_REFUSAL } from "./agent-sandbox.js";
import { TMUX_EXIT } from "./tmux.js";

/**
 * A coding agent's sandbox as its Terminal tab reaches it, through
 * `@vercel/sandbox` over a fake of Vercel answering from a script: a stopped sandbox lists no
 * shells and is never woken by a list or a start, a running one's shells are
 * read from tmux in its running session, a shell starts under the id given
 * and is read back, one tmux does not hold is not found, a list tmux could
 * not give is an outage, and only a resume wakes a stopped sandbox, by its
 * name. A GitHub credential is set at the firewall in its shape: an
 * installation's on GitHub's two hosts, a member's own on its repository's
 * paths alone, its record kept in the test's own database under a key ring
 * of the suite's. The token is a synthetic one, unexpired, so nothing
 * refreshes it.
 */

const SESSION = "wrun_fixture";
/** The agents' image as a deploy names it, the fixture's. */
const FIXTURE_IMAGE = {
  reference: Effect.succeed("agent-image:fixture"),
  base: Effect.succeed("agent-image-base:fixture"),
  runner: Effect.succeed(new Uint8Array()),
};
const SANDBOX = "eve-sbx-vercel-fixture";
const RUNNING_SESSION = "sbs_running";
const SHELL = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const REPOSITORY = "Acme/Relay";
const MEMBER_TOKEN = "member-token-fixture";

interface Asked {
  readonly method: string;
  readonly url: URL;
  readonly args?: readonly string[];
}

/** The running session of the fixture's sandbox, under an account of its own, whose firewall a credential is set at. */
const ownSession = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  return { userId, name: SANDBOX, sandboxSessionId: RUNNING_SESSION };
});

/** A command's stream as Vercel answers a waited run in the running session: the command, what it printed, and its end. */
const commandStream = (exitCode: number, stdout = "") =>
  commandRunStreamed({ id: "cmd_1", sessionId: RUNNING_SESSION }, { exitCode, stdout, stderr: "" });

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Vercel as the scenario has it: the session's sandbox in the status given,
 * tmux holding the shells the list prints, refusing to name a shell it does
 * not hold, and a resume that brings the sandbox up under a fresh session.
 */
function vercel(
  status: string | undefined,
  shells: readonly string[] = [],
  listExit = 0,
  interactiveUrl = "wss://sbx-fixture.vercel.run/ws",
  shellCheckExit: number = TMUX_EXIT.NO_SESSION,
) {
  // The layer asks under the deployment's own token, read where the platform hands it.
  vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
  const asked: Asked[] = [];
  const policies: unknown[] = [];
  const layer = Layer.provide(
    agentSandboxLayer,
    Layer.mergeAll(
      LOCAL_AGENT_ENVIRONMENT,
      Layer.succeed(AgentImage, FIXTURE_IMAGE),
      sandboxFetchOver(async (url, init) => {
        const parsed = new URL(url);
        const method = init.method ?? "GET";
        if (parsed.pathname.endsWith("/cmd")) {
          const body = JSON.parse(await new Response(init.body).text());
          const args: readonly string[] = body.args;
          asked.push({ method, url: parsed, args });
          // Every command is `sh -c <script> sh <tmux args>`; the list is the one with none.
          const scriptAt = args.indexOf("-c") + 1;
          const tmuxArgs = args.slice(scriptAt + 2);
          if (tmuxArgs.length === 0) return commandStream(listExit, shells.join("\n"));
          if (tmuxArgs[0] === "new-session") return commandStream(0);
          const named = tmuxArgs.some((arg) => arg.startsWith(`=terminal-${SHELL}`));
          // The shell check exits its own code for a session tmux does not hold, or what a tmux that would not start exits.
          if (args[scriptAt]?.includes("has-session"))
            return commandStream(named ? 0 : shellCheckExit);
          return commandStream(named ? 0 : 1);
        }
        asked.push({ method, url: parsed });
        if (parsed.pathname.endsWith("/interactive")) {
          return Response.json({ url: interactiveUrl, token: "pty-token" });
        }
        if (parsed.pathname.endsWith("/network-policy")) {
          policies.push(JSON.parse(await new Response(init.body).text()));
          return Response.json(sessionAnswered({ id: RUNNING_SESSION, status: "running" }));
        }
        const listed = {
          name: SANDBOX,
          status: status ?? "stopped",
          currentSessionId: RUNNING_SESSION,
          createdAt: 0,
        };
        if (parsed.searchParams.get("resume") === "true") {
          return Response.json(
            sandboxFound({ ...listed, status: "running", currentSessionId: "sbs_resumed" }),
          );
        }
        if (parsed.pathname === `/api/v2/sandboxes/${SANDBOX}`) {
          return Response.json(sandboxFound(listed));
        }
        return (
          sandboxListRefusal(parsed) ??
          Response.json(sandboxesListed(status === undefined ? [] : [listed]))
        );
      }),
    ),
  );
  return { layer, asked, policies };
}

/** One field as the list prints it: what tmux printed, newline and all, in base64. */
const field = (value: string) => Buffer.from(`${value}\n`).toString("base64");

const listedShell = (id: string, title: string, command: string) =>
  [`terminal-${id}`, "100", field(title), field(command), field("/workspace/repository")].join(" ");

it.layer(getTestDB())("a coding agent's sandbox", (it) => {
  it.effect(
    "a stopped sandbox lists no shells and no ports, and is never woken by a list or a start",
    () =>
      Effect.gen(function* () {
        const api = vercel("stopped");

        const { listed, ports, started } = yield* Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          return {
            listed: yield* sandbox.terminals(SESSION),
            ports: yield* sandbox.listeningPorts(SESSION),
            started: yield* sandbox.start(SESSION, SHELL, undefined),
          };
        }).pipe(Effect.provide(api.layer));

        assert.deepEqual(listed, { sandbox: SANDBOX_STATE.STOPPED, terminals: [] });
        assert.deepEqual(ports, { running: false, ports: [] });
        assert.deepEqual(
          started,
          Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: SANDBOX_STATE.STOPPED }),
        );
        assert.ok(api.asked.every((call) => call.url.searchParams.get("resume") !== "true"));
        assert.ok(api.asked.every((call) => !call.url.pathname.endsWith("/cmd")));
      }),
  );

  it.effect(
    "a running sandbox's shells are read from tmux in its running session, and one never opened is starting",
    () =>
      Effect.gen(function* () {
        const api = vercel("running", [listedShell(SHELL, "dev server", "node")]);

        const listed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.terminals(SESSION),
        ).pipe(Effect.provide(api.layer));
        const never = vercel(undefined);
        const unopened = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.terminals(SESSION),
        ).pipe(Effect.provide(never.layer));

        assert.deepEqual(listed, {
          sandbox: SANDBOX_STATE.RUNNING,
          terminals: [
            {
              id: SHELL,
              title: "dev server",
              command: "node",
              cwd: "/workspace/repository",
              running: true,
            },
          ],
        });
        const run = api.asked.find((call) => call.args !== undefined);
        assert.equal(run?.url.pathname, `/api/v2/sandboxes/sessions/${RUNNING_SESSION}/cmd`);
        assert.deepEqual(unopened, { sandbox: SANDBOX_STATE.STARTING, terminals: [] });
      }),
  );

  it.effect(
    "a running sandbox's ports are the ones its servers listen on, each once, never root's or the browser's, and tables it could not read are an outage",
    () =>
      Effect.gen(function* () {
        // The kernel's tables as `cat` prints them, by hand: the sandbox's init on 23456 as root,
        // the browser's DevTools on 9333, a dev server on 3000 over both families with a connection
        // to it, and a server on 5173.
        const tables = [
          "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
          "   0: 00000000:5BA0 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3107 1",
          "   1: 0100007F:2475 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 4100 1",
          "   2: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 4200 1",
          "   3: 0100007F:A2D2 0100007F:0BB8 01 00000000:00000000 00:00000000 00000000  1002        0 4300 1",
          "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
          "   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 4500 1",
          "   1: 00000000000000000000000000000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 4600 1",
        ];
        const api = vercel("running", tables);
        const unread = vercel("running", [], 1);

        const ports = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.listeningPorts(SESSION),
        ).pipe(Effect.provide(api.layer));
        const outage = yield* Effect.flip(
          Effect.flatMap(AgentSandbox, (sandbox) => sandbox.listeningPorts(SESSION)).pipe(
            Effect.provide(unread.layer),
          ),
        );

        assert.deepEqual(ports, { running: true, ports: [3000, 5173] });
        const run = api.asked.find((call) => call.args !== undefined);
        assert.equal(run?.url.pathname, `/api/v2/sandboxes/sessions/${RUNNING_SESSION}/cmd`);
        assert.ok(outage instanceof SandboxUnavailable);
      }),
  );

  it.effect(
    "a shell starts in the running sandbox under the id given and is read back, and one tmux does not hold is not found",
    () =>
      Effect.gen(function* () {
        const api = vercel("running", [listedShell(SHELL, "", "bash")]);
        const other = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

        const { started, renamedOther } = yield* Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          return {
            started: yield* sandbox.start(SESSION, SHELL, undefined),
            renamedOther: yield* sandbox.rename(SESSION, other, "tests"),
          };
        }).pipe(Effect.provide(api.layer));

        assert.deepEqual(
          started,
          Result.succeed({
            id: SHELL,
            title: "bash",
            command: "bash",
            cwd: "/workspace/repository",
            running: false,
          }),
        );
        assert.deepEqual(renamedOther, Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND }));
      }),
  );

  it.effect("a list tmux could not give is an outage, never a sandbox with no shells", () =>
    Effect.gen(function* () {
      const api = vercel("running", [], 1);

      const listed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.terminals(SESSION),
      ).pipe(Effect.provide(api.layer), Effect.flip);

      assert.ok(listed instanceof SandboxUnavailable);
    }),
  );

  it.effect("a resume wakes the stopped sandbox by its name and answers it running", () =>
    Effect.gen(function* () {
      const api = vercel("stopped");

      const resumed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.resume(SESSION),
      ).pipe(Effect.provide(api.layer));

      assert.equal(resumed, SANDBOX_STATE.RUNNING);
      const woken = api.asked.find((call) => call.url.searchParams.get("resume") === "true");
      assert.equal(woken?.url.pathname, `/api/v2/sandboxes/${SANDBOX}`);
    }),
  );

  it.effect(
    "a resume of a sandbox under its session's name whose snapshot is gone makes it again under that name, with its tags, the agent's user in it, and answers it running",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const fake = runnerSandboxApi();
        const image = Layer.succeed(AgentImage, FIXTURE_IMAGE);
        const tags = { sessionId: SESSION, agentId: "agent-fixture" };
        const opened = yield* Effect.gen(function* () {
          const api = yield* vercelSandboxApi(async () => fixtureToken());
          return yield* openAgentSandbox(api, { sessionId: SESSION, tags, vcpus: undefined });
        }).pipe(Effect.provide(Layer.merge(fake.layer, image)));
        const [expired] = fake.sandboxes;
        assert.ok(expired !== undefined);
        expired.status = "stopped";
        expired.snapshotExpired = true;
        const userMade = (run: { readonly args: readonly string[] }) =>
          run.args.join(" ") === "-m -s /bin/bash agent";
        const usersBefore = fake.runs.filter(userMade).length;

        const resumed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.resume(SESSION),
        ).pipe(
          Effect.provide(
            Layer.provide(
              agentSandboxLayer,
              Layer.mergeAll(LOCAL_AGENT_ENVIRONMENT, image, fake.layer),
            ),
          ),
        );

        assert.equal(resumed, SANDBOX_STATE.RUNNING);
        const remade = fake.sandboxes.at(-1);
        assert.ok(remade !== undefined && remade !== expired);
        assert.deepEqual(
          [expired.deleted, remade.deleted, remade.name, remade.tags],
          [true, false, opened.sandbox.name, tags],
        );
        assert.equal(fake.runs.filter(userMade).length, usersBefore + 1);
      }),
  );

  it.effect("an attach mints the running session's PTY and never wakes a stopped sandbox", () =>
    Effect.gen(function* () {
      const running = vercel("running");
      const stopped = vercel("stopped");

      const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.attach(SESSION, SHELL),
      ).pipe(Effect.provide(running.layer));
      const refused = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.attach(SESSION, SHELL),
      ).pipe(Effect.provide(stopped.layer));

      assert.equal(attached.state, SANDBOX_STATE.RUNNING);
      assert.ok("shell" in attached && attached.shell.url === "wss://sbx-fixture.vercel.run/ws");
      const mint = running.asked.find((call) => call.url.pathname.endsWith("/interactive"));
      assert.equal(mint?.url.pathname, `/api/v2/sandboxes/sessions/${RUNNING_SESSION}/interactive`);
      assert.deepEqual(refused, { state: SANDBOX_STATE.STOPPED });
      assert.ok(stopped.asked.every((call) => call.url.searchParams.get("resume") !== "true"));
      assert.ok(stopped.asked.every((call) => !call.url.pathname.endsWith("/interactive")));
    }),
  );

  it.effect(
    "a minted PTY address off Vercel's sandbox domain is refused, its token never handed on",
    () =>
      Effect.gen(function* () {
        const addresses = [
          "wss://pty.attacker.test/ws",
          "wss://vercel.run.attacker.test/ws",
          "ws://sbx-fixture.vercel.run/ws",
          "wss://user:pass@sbx-fixture.vercel.run/ws",
        ];

        for (const address of addresses) {
          const api = vercel("running", [], 0, address);
          const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
            sandbox.attach(SESSION, SHELL),
          ).pipe(Effect.provide(api.layer), Effect.flip);
          assert.ok(attached instanceof SandboxUnavailable, address);
        }
      }),
  );

  it.effect("an attach to a shell tmux does not hold is gone, and no PTY is minted for it", () =>
    Effect.gen(function* () {
      const api = vercel("running");
      const unknown = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

      const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.attach(SESSION, unknown),
      ).pipe(Effect.provide(api.layer));

      assert.deepEqual(attached, { state: SANDBOX_STATE.RUNNING, gone: true });
      assert.ok(api.asked.every((call) => !call.url.pathname.endsWith("/interactive")));
    }),
  );

  it.effect(
    "a tmux that could not be asked is an outage the tab may retry, never a shell gone",
    () =>
      Effect.gen(function* () {
        const api = vercel("running", [], 0, undefined, 1);
        const unknown = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

        const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.attach(SESSION, unknown),
        ).pipe(Effect.provide(api.layer), Effect.flip);

        assert.ok(attached instanceof SandboxUnavailable);
      }),
  );

  it.effect(
    "an installation's token is set at the firewall on GitHub's two hosts alone, every other host left open",
    () =>
      Effect.gen(function* () {
        const api = vercel("running");
        const session = yield* ownSession;

        yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.setCredential(session, {
            token: Redacted.make("ghs_fixture"),
            fullName: REPOSITORY,
            access: { kind: GITHUB_ACCESS.APP },
          }),
        ).pipe(Effect.provide(api.layer));

        const authorization = `Basic ${Buffer.from("x-access-token:ghs_fixture").toString("base64")}`;
        const injected = [{ transform: [{ headers: { authorization } }] }];
        assert.deepEqual(api.policies, [
          { allow: { "*": [], "github.com": injected, "api.github.com": injected } },
        ]);
      }),
  );

  it.effect(
    "a member's own token is set on the repository's git paths as Basic under their login and on its REST paths as a bearer, and nowhere else",
    () =>
      Effect.gen(function* () {
        const api = vercel("running");
        const session = yield* ownSession;

        yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.setCredential(session, {
            token: Redacted.make(MEMBER_TOKEN),
            fullName: REPOSITORY,
            access: {
              kind: GITHUB_ACCESS.TOKEN,
              githubLogin: "octo-member",
              githubUserId: "4242",
              markInvalid: Effect.void,
            },
          }),
        ).pipe(Effect.provide(api.layer));

        const basic = `Basic ${Buffer.from(`octo-member:${MEMBER_TOKEN}`).toString("base64")}`;
        const bearer = `Bearer ${MEMBER_TOKEN}`;
        assert.deepEqual(api.policies, [
          {
            allow: {
              "*": [],
              "github.com": [
                {
                  match: { path: { startsWith: `/${REPOSITORY}.git/` } },
                  transform: [{ headers: { authorization: basic } }],
                },
              ],
              "api.github.com": [
                {
                  match: { path: { exact: `/repos/${REPOSITORY}` } },
                  transform: [{ headers: { authorization: bearer } }],
                },
                {
                  match: { path: { startsWith: `/repos/${REPOSITORY}/` } },
                  transform: [{ headers: { authorization: bearer } }],
                },
              ],
            },
          },
        ]);
      }),
  );
});
