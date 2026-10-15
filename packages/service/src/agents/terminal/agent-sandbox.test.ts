import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Redacted, Result } from "effect";
import { afterEach, vi } from "vitest";
import { sandboxListRefusal } from "../../testing/vercel-sandbox-fake.js";
import { SandboxUnavailable } from "../vercel-sandbox-api.js";
import { AgentSandbox, agentSandboxLayer, SHELL_REFUSAL } from "./agent-sandbox.js";
import { TMUX_EXIT } from "./tmux.js";

/**
 * A coding agent's sandbox as its Terminal tab reaches it, over Vercel
 * Sandbox's REST API answering from a script: a stopped sandbox lists no
 * shells and is never woken by a list or a start, a running one's shells are
 * read from tmux in its running session, a shell starts under the id given
 * and is read back, one tmux does not hold is not found, a list tmux could
 * not give is an outage, and only a resume wakes a stopped sandbox, by its
 * name. The token is a synthetic one the
 * environment carries, unexpired, so nothing refreshes it.
 */

const SESSION = "wrun_fixture";
const SANDBOX = "eve-sbx-vercel-fixture";
const RUNNING_SESSION = "sbs_running";
const SHELL = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";

/** An unsigned token naming a fixture project and team, a year from expiring. */
function fixtureToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 14) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ project_id: "prj_fixture", owner_id: "team_fixture", exp }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

interface Asked {
  readonly method: string;
  readonly url: URL;
  readonly args?: readonly string[];
}

/** A command's stream as Vercel answers a waited run: the command, what it printed, and its end. */
function commandStream(exitCode: number, stdout = ""): Response {
  const lines = [
    { command: { id: "cmd_1", exitCode: null } },
    ...(stdout === "" ? [] : [{ stream: "stdout", data: stdout }]),
    { command: { id: "cmd_1", exitCode } },
  ];
  return new Response(lines.map((line) => JSON.stringify(line)).join("\n"), {
    headers: { "content-type": "application/x-ndjson" },
  });
}

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
  const asked: Asked[] = [];
  const policies: unknown[] = [];
  const layer = Layer.provide(
    agentSandboxLayer,
    fakeHttpClientLayer(async (url, init) => {
      const parsed = new URL(url);
      const method = init.method ?? "GET";
      if (parsed.pathname.endsWith("/cmd")) {
        const body = JSON.parse(await new Response(init.body).text());
        const args: readonly string[] = body.args;
        asked.push({ method, url: parsed, args });
        // Every command is `sh -c <script> sh <tmux args>`; the list is the one with none.
        const tmuxArgs = args.slice(3);
        if (tmuxArgs.length === 0) return commandStream(listExit, shells.join("\n"));
        if (tmuxArgs[0] === "new-session") return commandStream(0);
        const named = tmuxArgs.some((arg) => arg.startsWith(`=luke-${SHELL}`));
        // The shell check exits its own code for a session tmux does not hold, or what a failed install exits.
        if (args[1]?.includes("has-session")) return commandStream(named ? 0 : shellCheckExit);
        return commandStream(named ? 0 : 1);
      }
      asked.push({ method, url: parsed });
      if (parsed.pathname.endsWith("/interactive")) {
        return Response.json({ url: interactiveUrl, token: "pty-token" });
      }
      if (parsed.pathname.endsWith("/network-policy")) {
        policies.push(JSON.parse(await new Response(init.body).text()));
        return Response.json({});
      }
      if (parsed.searchParams.get("resume") === "true") {
        return Response.json({
          sandbox: { name: SANDBOX, status: "stopped" },
          session: { id: "sbs_resumed", status: "running" },
        });
      }
      return (
        sandboxListRefusal(parsed) ??
        Response.json({
          sandboxes:
            status === undefined
              ? []
              : [{ name: SANDBOX, status, currentSessionId: RUNNING_SESSION }],
        })
      );
    }),
  );
  return { layer, asked, policies };
}

/** One field as the list prints it: what tmux printed, newline and all, in base64. */
const field = (value: string) => Buffer.from(`${value}\n`).toString("base64");

const listedShell = (id: string, title: string, command: string) =>
  [`luke-${id}`, "100", field(title), field(command), field("/workspace/repository")].join(" ");

afterEach(() => {
  vi.unstubAllEnvs();
});

it.effect("a stopped sandbox lists no shells and is never woken by a list or a start", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercel("stopped");

    const { listed, started } = yield* Effect.gen(function* () {
      const sandbox = yield* AgentSandbox;
      return {
        listed: yield* sandbox.terminals(SESSION),
        started: yield* sandbox.start(SESSION, SHELL, undefined),
      };
    }).pipe(Effect.provide(api.layer));

    assert.deepEqual(listed, { sandbox: SANDBOX_STATE.STOPPED, terminals: [] });
    assert.deepEqual(
      started,
      Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: SANDBOX_STATE.STOPPED }),
    );
    assert.ok(api.asked.every((call) => call.url.searchParams.get("resume") === null));
    assert.ok(api.asked.every((call) => !call.url.pathname.endsWith("/cmd")));
  }),
);

it.effect(
  "a running sandbox's shells are read from tmux in its running session, and one never opened is starting",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel("running", [listedShell(SHELL, "dev server", "node")]);
      const never = vercel(undefined);

      const listed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.terminals(SESSION),
      ).pipe(Effect.provide(api.layer));
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
  "a shell starts in the running sandbox under the id given and is read back, and one tmux does not hold is not found",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
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
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercel("running", [], 1);

    const listed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
      sandbox.terminals(SESSION),
    ).pipe(Effect.provide(api.layer), Effect.flip);

    assert.ok(listed instanceof SandboxUnavailable);
  }),
);

it.effect("a resume wakes the stopped sandbox by its name and answers it running", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercel("stopped");

    const resumed = yield* Effect.flatMap(AgentSandbox, (sandbox) => sandbox.resume(SESSION)).pipe(
      Effect.provide(api.layer),
    );

    assert.equal(resumed, SANDBOX_STATE.RUNNING);
    const woken = api.asked.find((call) => call.url.searchParams.get("resume") === "true");
    assert.equal(woken?.url.pathname, `/api/v2/sandboxes/${SANDBOX}`);
  }),
);

it.effect("an attach mints the running session's PTY and never wakes a stopped sandbox", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
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
    assert.ok(stopped.asked.every((call) => call.url.searchParams.get("resume") === null));
    assert.ok(stopped.asked.every((call) => !call.url.pathname.endsWith("/interactive")));
  }),
);

it.effect(
  "a minted PTY address off Vercel's sandbox domain is refused, its token never handed on",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
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
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercel("running");
    const unknown = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

    const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
      sandbox.attach(SESSION, unknown),
    ).pipe(Effect.provide(api.layer));

    assert.deepEqual(attached, { state: SANDBOX_STATE.RUNNING, gone: true });
    assert.ok(api.asked.every((call) => !call.url.pathname.endsWith("/interactive")));
  }),
);

it.effect("a tmux that could not be asked is an outage the tab may retry, never a shell gone", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercel("running", [], 0, undefined, 1);
    const unknown = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

    const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
      sandbox.attach(SESSION, unknown),
    ).pipe(Effect.provide(api.layer), Effect.flip);

    assert.ok(attached instanceof SandboxUnavailable);
  }),
);

it.effect(
  "the GitHub credentials are set at the firewall on GitHub's two hosts alone, the App's for git and the developer's for the API, every other host left open",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel("running");

      yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.setGitHubCredentials(RUNNING_SESSION, {
          git: Redacted.make("ghs_fixture"),
          api: Redacted.make("ghu_fixture"),
        }),
      ).pipe(Effect.provide(api.layer));

      const basic = `Basic ${Buffer.from("x-access-token:ghs_fixture").toString("base64")}`;
      assert.deepEqual(api.policies, [
        {
          allow: {
            "*": [],
            "github.com": [{ transform: [{ headers: { authorization: basic } }] }],
            "api.github.com": [
              { transform: [{ headers: { authorization: "Bearer ghu_fixture" } }] },
            ],
          },
        },
      ]);
    }),
);
