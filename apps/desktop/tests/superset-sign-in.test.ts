import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test, { type TestContext } from "node:test";
import { isRecord, text } from "@sidecar/core";
import { SUPERSET_SIGN_IN_STAGE } from "../src/shared/contracts";
import { SupersetCli } from "../src/superset-cli";
import { SupersetSignIn, validSupersetSignInCode } from "../src/superset-sign-in";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

async function homeWithCli(t: TestContext): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "luke-superset-sign-in-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, "bin"), { recursive: true });
  await fs.writeFile(path.join(home, "bin", "superset"), "#!/bin/sh\n");
  return home;
}

function testCliOptions(homeDirectory: string) {
  return {
    homeDirectory,
    organizationId: async () => {
      try {
        const parsed: unknown = JSON.parse(
          await fs.readFile(path.join(homeDirectory, "config.json"), "utf8"),
        );
        return isRecord(parsed) ? text(parsed.organizationId) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

function testCli(homeDirectory: string): SupersetCli {
  return new SupersetCli(testCliOptions(homeDirectory));
}

async function turn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("state did not settle");
}

test("login streams a pinned authorization URL and submits one bounded code", async (t) => {
  const home = await homeWithCli(t);
  const child = new FakeChild();
  const opened: string[] = [];
  let written = "";
  child.stdin.on("data", (chunk) => {
    written += String(chunk);
  });
  const signIn = new SupersetSignIn({
    cli: testCli(home),
    openExternal: async (url) => opened.push(url),
    onChange: () => undefined,
    spawnLogin: (executable, arguments_) => {
      assert.equal(executable, path.join(home, "bin", "superset"));
      assert.deepEqual(arguments_, ["auth", "login", "--json"]);
      return child;
    },
  });

  assert.equal((await signIn.begin()).stage, SUPERSET_SIGN_IN_STAGE.BROWSER_CODE);
  child.stdout.write("Open https://api.super");
  child.stdout.write("set.sh/api/auth/oauth2/authorize?attempt=one\nignored secret output");
  await turn();
  assert.deepEqual(opened, ["https://api.superset.sh/api/auth/oauth2/authorize?attempt=one"]);
  assert.equal(signIn.submitCode("device#proof").stage, SUPERSET_SIGN_IN_STAGE.EXCHANGING);
  assert.equal(written, "device#proof\r");

  await fs.writeFile(path.join(home, "config.json"), '{"organizationId":"org-1"}');
  child.emit("close", 0);
  await waitFor(() => signIn.current().stage === SUPERSET_SIGN_IN_STAGE.CONNECTED);
  assert.equal(signIn.current().stage, SUPERSET_SIGN_IN_STAGE.CONNECTED);
});

test("only the pinned Superset HTTPS host can be opened or reopened", async (t) => {
  const home = await homeWithCli(t);
  const child = new FakeChild();
  const opened: string[] = [];
  const signIn = new SupersetSignIn({
    cli: testCli(home),
    openExternal: async (url) => opened.push(url),
    onChange: () => undefined,
    spawnLogin: () => child,
  });
  await signIn.begin();
  child.stderr.write(
    "https://evil.example/auth https://api.superset.sh.evil.example/api/auth/oauth2/authorize https://api.superset.sh/not-oauth",
  );
  signIn.reopen();
  assert.deepEqual(opened, []);
  child.stderr.write(" https://api.superset.sh/api/auth/oauth2/authorize?attempt=two");
  await turn();
  signIn.reopen();
  assert.deepEqual(opened, [
    "https://api.superset.sh/api/auth/oauth2/authorize?attempt=two",
    "https://api.superset.sh/api/auth/oauth2/authorize?attempt=two",
  ]);
  signIn.cancel();
});

test("codes require one separator, stay bounded, and can arrive before the URL", async (t) => {
  const home = await homeWithCli(t);
  const child = new FakeChild();
  let written = "";
  child.stdin.on("data", (chunk) => {
    written += String(chunk);
  });
  const signIn = new SupersetSignIn({
    cli: testCli(home),
    openExternal: async () => undefined,
    onChange: () => undefined,
    spawnLogin: () => child,
  });
  await signIn.begin();
  assert.equal(validSupersetSignInCode("missing"), false);
  assert.equal(validSupersetSignInCode(`a#${"b".repeat(511)}`), false);
  assert.equal(validSupersetSignInCode("a#b#c"), false);
  assert.equal(signIn.submitCode("early#proof").stage, SUPERSET_SIGN_IN_STAGE.EXCHANGING);
  assert.equal(written, "early#proof\r");
  signIn.cancel();
});

test("duplicate starts share one attempt and cancellation kills its exact child", async (t) => {
  const home = await homeWithCli(t);
  const child = new FakeChild();
  let spawns = 0;
  const signIn = new SupersetSignIn({
    cli: testCli(home),
    openExternal: async () => undefined,
    onChange: () => undefined,
    spawnLogin: () => {
      spawns += 1;
      return child;
    },
  });
  await Promise.all([signIn.begin(), signIn.begin()]);
  assert.equal(spawns, 1);
  signIn.cancel();
  assert.equal(child.killed, true);
  assert.equal(signIn.current().stage, SUPERSET_SIGN_IN_STAGE.IDLE);
});

test("process failure, timeout, and shutdown end without exposing CLI output", async (t) => {
  const home = await homeWithCli(t);
  for (const ending of ["error", "timeout", "shutdown"] as const) {
    const child = new FakeChild();
    const states: string[] = [];
    const signIn = new SupersetSignIn({
      cli: testCli(home),
      openExternal: async () => undefined,
      onChange: (state) => states.push(JSON.stringify(state)),
      spawnLogin: () => child,
      timeoutMs: ending === "timeout" ? 1 : 60_000,
    });
    await signIn.begin();
    child.stderr.write("token=must-not-cross-the-boundary");
    if (ending === "error") child.emit("error", new Error("secret output"));
    if (ending === "shutdown") signIn.shutdown();
    await new Promise((resolve) => setTimeout(resolve, ending === "timeout" ? 5 : 0));
    assert.equal(
      states.some((state) => state.includes("must-not-cross")),
      false,
    );
    assert.equal(child.killed, true);
    assert.ok(
      signIn.current().stage === SUPERSET_SIGN_IN_STAGE.FAILURE ||
        signIn.current().stage === SUPERSET_SIGN_IN_STAGE.IDLE,
    );
  }
});

test("zero organizations fail; listed organizations are offered and revalidated", async (t) => {
  const home = await homeWithCli(t);
  const organizations = [{ id: "org-1", name: "Acme", slug: "acme" }];
  let listed = organizations;
  const cli = new SupersetCli({
    ...testCliOptions(home),
    query: async (_executable, arguments_) => {
      if (arguments_[1] === "list") return JSON.stringify({ data: listed });
      await fs.writeFile(path.join(home, "config.json"), '{"organizationId":"org-1"}');
      return "{}";
    },
  });
  const first = new FakeChild();
  const signIn = new SupersetSignIn({
    cli,
    openExternal: async () => undefined,
    onChange: () => undefined,
    spawnLogin: () => first,
  });
  await signIn.begin();
  first.emit("close", 1);
  await waitFor(() => signIn.current().stage === SUPERSET_SIGN_IN_STAGE.ORGANIZATION);
  assert.deepEqual(signIn.current(), {
    stage: SUPERSET_SIGN_IN_STAGE.ORGANIZATION,
    organizations,
  });
  listed = [];
  assert.equal((await signIn.chooseOrganization("acme")).stage, SUPERSET_SIGN_IN_STAGE.FAILURE);

  const chosen = new FakeChild();
  listed = organizations;
  const stages: string[] = [];
  const switching = new SupersetSignIn({
    cli,
    openExternal: async () => undefined,
    onChange: (state) => stages.push(state.stage),
    spawnLogin: () => chosen,
  });
  await fs.rm(path.join(home, "config.json"), { force: true });
  await switching.begin();
  chosen.emit("close", 1);
  await waitFor(() => switching.current().stage === SUPERSET_SIGN_IN_STAGE.ORGANIZATION);
  assert.equal(
    (await switching.chooseOrganization("acme")).stage,
    SUPERSET_SIGN_IN_STAGE.CONNECTED,
  );
  // The switch is its own stage: drawn as the code exchange, the slot would
  // ask for a second code nobody owes.
  assert.ok(stages.includes(SUPERSET_SIGN_IN_STAGE.SWITCHING));
  assert.equal(stages.includes(SUPERSET_SIGN_IN_STAGE.EXCHANGING), false);
  await fs.rm(path.join(home, "config.json"), { force: true });

  const second = new FakeChild();
  listed = [];
  const empty = new SupersetSignIn({
    cli,
    openExternal: async () => undefined,
    onChange: () => undefined,
    spawnLogin: () => second,
  });
  await empty.begin();
  second.emit("close", 1);
  await waitFor(() => empty.current().stage === SUPERSET_SIGN_IN_STAGE.FAILURE);
  assert.equal(empty.current().stage, SUPERSET_SIGN_IN_STAGE.FAILURE);
});
