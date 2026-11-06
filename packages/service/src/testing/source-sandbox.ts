import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Deferred, Effect } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../agents/repository-sandbox-contract.js";
import {
  commandRunStreamed,
  sandboxesListed,
  sandboxFound,
  sandboxListRefusal,
  sandboxStopRefusal,
  sessionAnswered,
} from "./vercel-sandbox-fake.js";

export const SOURCE_SANDBOX = {
  NAME: "eve-sbx-vercel-fixture",
  RUNNING: "sbs_running",
  WOKEN: "sbs_woken",
  STOPPED: "sbs_stopped",
} as const;

function gitEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
}

export function fixtureOidcToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 14) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ project_id: "prj_fixture", owner_id: "team_fixture", exp }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

export interface SourceCheckout {
  readonly root: string;
  readonly remote: string;
  readonly checkout: string;
  readonly sh: (cwd: string, command: string, ...args: string[]) => string;
}

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

export interface SentToSandbox {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

export interface SourceSandbox {
  readonly state: { status: string | undefined; session: string | undefined };
  readonly stops: string[];
  readonly stopAsked: Deferred.Deferred<void>;
  readonly policies: { readonly session: string; readonly hosts: readonly string[] }[];
  readonly ran: string[];
  readonly answer: (sent: SentToSandbox) => Response | undefined;
}

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
      return commandRunStreamed(
        { id: "cmd_1", sessionId: session },
        { exitCode: done.status ?? 1, stdout: done.stdout, stderr: done.stderr },
      );
    }
    if (parsed.pathname.endsWith("/stop") && method === "POST") {
      const refused = sandboxStopRefusal({ headers });
      if (refused === undefined) {
        stops.push(session);
        state.status = "stopped";
      }
      Deferred.doneUnsafe(stopAsked, Effect.void);
      return refused ?? Response.json(sessionAnswered({ id: session, status: "stopped" }));
    }
    if (parsed.pathname.endsWith("/network-policy")) {
      policies.push({ session, hosts: Object.keys(JSON.parse(body).allow ?? {}) });
      return Response.json(sessionAnswered({ id: session, status: "running" }));
    }
    if (parsed.searchParams.get("resume") === "true") {
      state.status = "running";
      state.session = SOURCE_SANDBOX.WOKEN;
    }
    const listed = {
      name: SOURCE_SANDBOX.NAME,
      status: state.status ?? "stopped",
      currentSessionId: state.session ?? SOURCE_SANDBOX.STOPPED,
      createdAt: 0,
    };
    if (parsed.pathname === `/api/v2/sandboxes/${SOURCE_SANDBOX.NAME}`) {
      return Response.json(sandboxFound(listed));
    }
    return (
      sandboxListRefusal(parsed) ??
      Response.json(sandboxesListed(state.status === undefined ? [] : [listed]))
    );
  };
  return { state, stops, stopAsked, policies, ran, answer };
}
