/**
 * source-sandbox.ts -- a coding agent's sandbox at Vercel's REST boundary, its shell a real one over a git checkout on disk, for the suites that copy a source agent's work.
 *
 * The double answers Vercel Sandbox's API as the scenario has it: the
 * session's sandbox in the status given, a resume that brings it up under a
 * fresh session, a stop that stops it where it is sent as JSON and is
 * refused with 415 where not, as Vercel refuses it, a firewall policy
 * written down, and each command run in a checkout the test made by a real
 * POSIX shell with git, what it printed on stdout and stderr streamed back,
 * refused where it names any directory but the agent's checkout. The
 * checkout is the way an agent leaves one: cloned from a bare remote on
 * disk, one commit pushed, its identity set. Synthetic throughout.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Deferred, Effect } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../agents/repository-sandbox-contract.js";
import { sandboxListRefusal, sandboxStopRefusal } from "./vercel-sandbox-fake.js";

export const SOURCE_SANDBOX = {
  NAME: "eve-sbx-vercel-fixture",
  RUNNING: "sbs_running",
  WOKEN: "sbs_woken",
} as const;

/** git as the sandbox runs it, kept from the host's own configuration. */
function gitEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
}

/** An unsigned token naming a fixture project and team, a year from expiring, as the deployment's OIDC token. */
export function fixtureOidcToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 14) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ project_id: "prj_fixture", owner_id: "team_fixture", exp }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

/** A source agent's checkout and the remote it pushes to, with a command run in either. */
export interface SourceCheckout {
  readonly root: string;
  readonly remote: string;
  readonly checkout: string;
  /** A command run in the directory given, its stdout trimmed. */
  readonly sh: (cwd: string, command: string, ...args: string[]) => string;
}

/** A checkout in the directory given, on `main`, with two files committed and pushed to a bare remote beside it. */
export function sourceCheckout(root: string): SourceCheckout {
  const sh = (cwd: string, command: string, ...args: string[]) =>
    execFileSync(command, args, {
      cwd,
      env: gitEnvironment(root),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const remote = join(root, "remote.git");
  const checkout = join(root, "checkout");
  mkdirSync(checkout);
  sh(root, "git", "init", "--quiet", "--bare", "--initial-branch=main", remote);
  sh(checkout, "git", "init", "--quiet", "--initial-branch=main");
  sh(checkout, "git", "remote", "add", "origin", remote);
  sh(checkout, "git", "config", "user.name", "Fixture Developer");
  sh(checkout, "git", "config", "user.email", "developer@example.invalid");
  writeFileSync(join(checkout, ".gitignore"), "dist/\n");
  writeFileSync(join(checkout, "invites.ts"), "export const ttl = 1;\n");
  writeFileSync(join(checkout, "mailer.ts"), "export const from = 'a';\n");
  sh(checkout, "git", "add", "-A");
  sh(checkout, "git", "commit", "--quiet", "-m", "Start invites");
  sh(checkout, "git", "push", "--quiet", "origin", "main");
  return { root, remote, checkout, sh };
}

/** A command's stream as Vercel answers a waited run: the command, what it printed, and its end. */
function commandStream(exitCode: number, stdout: string, stderr: string): Response {
  const lines = [
    { command: { id: "cmd_1", exitCode: null } },
    ...(stdout === "" ? [] : [{ stream: "stdout", data: stdout }]),
    ...(stderr === "" ? [] : [{ stream: "stderr", data: stderr }]),
    { command: { id: "cmd_1", exitCode } },
  ];
  return new Response(lines.map((line) => JSON.stringify(line)).join("\n"));
}

/** A request of the double as it was sent: its address, method, headers, and body as text. */
export interface SentToSandbox {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

/** The sandbox as the double holds it, and what was asked of it. */
export interface SourceSandbox {
  readonly state: { status: string | undefined; session: string | undefined };
  /** The sessions it stopped, in order; a stop it refused is none of them. */
  readonly stops: string[];
  /** Settles once a stop is first asked of it, whether it stopped or refused it. */
  readonly stopAsked: Deferred.Deferred<void>;
  readonly policies: { readonly session: string; readonly hosts: readonly string[] }[];
  /** The session each command ran in, in order. */
  readonly ran: string[];
  /** Vercel's answer to a request of the sandbox API, or nothing for a request of any other host. */
  readonly answer: (sent: SentToSandbox) => Response | undefined;
}

/** The double over the checkout given, its sandbox first listed in the status given, or none listed for a session that never opened one. */
export function sourceSandbox(source: SourceCheckout, status: string | undefined): SourceSandbox {
  const state: SourceSandbox["state"] = {
    status,
    session: status === "running" ? SOURCE_SANDBOX.RUNNING : undefined,
  };
  const stops: string[] = [];
  const stopAsked = Deferred.makeUnsafe<void>();
  const policies: SourceSandbox["policies"] = [];
  const ran: string[] = [];
  const answer = ({ url, method, headers, body }: SentToSandbox): Response | undefined => {
    const parsed = new URL(url);
    if (parsed.host !== "vercel.com") return undefined;
    const session = /\/sessions\/([^/]+)\//u.exec(parsed.pathname)?.[1] ?? "";
    if (parsed.pathname.endsWith("/cmd")) {
      const asked = JSON.parse(body);
      assert.equal(asked.cwd, REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT);
      assert.equal(session, state.session);
      ran.push(session);
      const done = spawnSync(asked.command, asked.args, {
        cwd: source.checkout,
        env: gitEnvironment(source.root),
        encoding: "utf8",
      });
      return commandStream(done.status ?? 1, done.stdout, done.stderr);
    }
    if (parsed.pathname.endsWith("/stop") && method === "POST") {
      const refused = sandboxStopRefusal({ headers });
      if (refused === undefined) {
        stops.push(session);
        state.status = "stopped";
      }
      // Settled once the stop is recorded, since a fiber awaiting it may resume before this returns.
      Deferred.doneUnsafe(stopAsked, Effect.void);
      return refused ?? Response.json({});
    }
    if (parsed.pathname.endsWith("/network-policy")) {
      policies.push({ session, hosts: Object.keys(JSON.parse(body).allow) });
      return Response.json({});
    }
    if (parsed.searchParams.get("resume") === "true") {
      state.status = "running";
      state.session = SOURCE_SANDBOX.WOKEN;
      return Response.json({
        sandbox: { name: SOURCE_SANDBOX.NAME, status: "stopped" },
        session: { id: SOURCE_SANDBOX.WOKEN, status: "running" },
      });
    }
    return (
      sandboxListRefusal(parsed) ??
      Response.json({
        sandboxes:
          state.status === undefined
            ? []
            : [
                {
                  name: SOURCE_SANDBOX.NAME,
                  status: state.status,
                  currentSessionId: state.session,
                },
              ],
      })
    );
  };
  return { state, stops, stopAsked, policies, ran, answer };
}
