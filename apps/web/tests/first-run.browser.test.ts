import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@repo/runtime/testing";
import pg from "pg";
import { chromium } from "playwright";
import { expect, test } from "vitest";

/**
 * first-run.browser.test.ts -- an account that has never signed in reaches a
 * usable start: its first sign-in lands it in a personal workspace the app
 * made for it, Settings › Workspace loads, and the home page's repository
 * picker opens beside a composer.
 *
 * On Nov 4, 2026, no account made since #3924 had a workspace, and nothing
 * that ran the real app on a new account noticed for fourteen days. This runs
 * the real app as the local demo does (`scripts/run.sh`): the demo Postgres,
 * the demo seed, and the local server, in Chromium. The seed gives its member
 * a workspace, which would hide that bug, so the member's memberships and
 * personal workspace row are deleted before the first sign-in. It stops short
 * of Start, which needs a GitHub App and model credentials the stack has none
 * of.
 *
 * It owns its world as far as a browser test can: a Postgres in a temp folder
 * of its own, a server on a free loopback port, and nothing off the machine.
 * It runs where `APP_FIRST_RUN_BROWSER` is set, CI's First run job, which
 * installs Chromium (`vitest.config.ts`).
 */

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPOSITORY = path.join(WEB, "..", "..");
const DEMO_EMAIL = "dean@example.com";
const LOOPBACK = "127.0.0.1";
const POLL_MS = 250;
const STOP_GRACE_MS = 5000;
const WAIT = { DATABASE_MS: 120_000, SERVER_MS: 120_000, PAGE_MS: 60_000 } as const;

// Note that the stack takes most of a minute to stand up (migrations, the
// seed, and Vite's first compile of the panel), so the case is held to
// minutes, not seconds.
const CASE_TIMEOUT_MS = 300_000;

function randomKey(): string {
  return randomBytes(32).toString("base64");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port was assigned")),
      );
    });
  });
}

/** The environment a child runs in: this one, less every `VERCEL*` variable, which the local server refuses to start beside. */
function childEnvironment(added: Record<string, string>): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !name.startsWith("VERCEL"));
  return { ...Object.fromEntries(kept), ...added };
}

/** A child whose output is kept, so a failure can say what it printed. */
function started(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv) {
  const [program, ...args] = command;
  const child = spawn(program ?? "node", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let printed = "";
  const keep = (chunk: Buffer) => {
    printed = (printed + chunk.toString()).slice(-8000);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  return { child, printed: () => printed };
}

async function finished(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv) {
  const run = started(command, cwd, env);
  const code = await new Promise<number | null>((resolve) => run.child.once("exit", resolve));
  if (code !== 0) throw new Error(`${command.join(" ")} exited ${code}:\n${run.printed()}`);
}

// Note that the local server takes up to half a minute to finish a graceful
// stop, which the test has no use for, so a child still running after a
// short grace is killed.
async function stopped(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([exited.then(() => true), sleep(STOP_GRACE_MS, false)]);
  if (graceful) return;
  child.kill("SIGKILL");
  await exited;
}

async function waitFor<T>(
  what: string,
  deadlineMs: number,
  read: () => Promise<T | undefined>,
  printed: () => string,
): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    await sleep(POLL_MS);
  }
  throw new Error(`${what} within ${deadlineMs} ms; it printed:\n${printed()}`);
}

async function query<Row>(url: string, text: string, values: readonly unknown[]): Promise<Row[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text, [...values])).rows as Row[];
  } finally {
    await client.end();
  }
}

/** The seeded member as an account that has never signed in: no membership and no personal workspace. */
async function forgetWorkspaces(url: string): Promise<void> {
  const [user] = await query<{ id: string }>(url, `select id from "user" where email = $1`, [
    DEMO_EMAIL,
  ]);
  expect(user, `the demo seed wrote ${DEMO_EMAIL}`).toBeDefined();
  await query(url, "delete from member where user_id = $1", [user?.id]);
  await query(url, "delete from personal_workspace where user_id = $1", [user?.id]);
}

test(
  "an account's first sign-in reaches a personal workspace, its settings, and the composer",
  async (t) => {
    const folder = await temporaryDirectory(t, "first-run-");
    const keyRing = `1:${randomKey()}`;

    const database = started(
      ["node", "tools/demo-postgres/demo-postgres.ts", "--url-file", path.join(folder, "url")],
      REPOSITORY,
      childEnvironment({}),
    );
    t.onTestFinished(() => stopped(database.child));
    const url = await waitFor(
      "the demo Postgres was not ready",
      WAIT.DATABASE_MS,
      async () => (await readFile(path.join(folder, "url"), "utf8")).trim() || undefined,
      database.printed,
    );

    // Note that the server needs only the migrated database, so it starts
    // while the seed writes, and the browser loads the signed-out app while
    // the seed finishes, so Vite's first compile overlaps it too.
    const seeded = finished(
      ["node", "--import", "tsx", "server/demo-seed.ts"],
      WEB,
      childEnvironment({ DATABASE_URL: url, PROVIDER_KEY_ENCRYPTION_KEYS: keyRing }),
    ).then(() => forgetWorkspaces(url));
    seeded.catch(() => undefined);

    const port = await freePort();
    const origin = `http://${LOOPBACK}:${port}`;
    const server = started(
      ["node", "--import", "tsx", "scripts/local-server.ts", "--port", String(port)],
      WEB,
      childEnvironment({
        DATABASE_URL: url,
        DATABASE_URL_UNPOOLED: url,
        BETTER_AUTH_SECRET: randomKey(),
        PROVIDER_KEY_ENCRYPTION_KEYS: keyRing,
        CRON_SECRET: randomKey(),
        BETTER_AUTH_URL: origin,
        APP_DEPLOYMENT_ORIGIN: origin,
      }),
    );
    t.onTestFinished(() => stopped(server.child));
    await waitFor(
      `the local server did not answer at ${origin}`,
      WAIT.SERVER_MS,
      async () => ((await fetch(`${origin}/api/auth/ok`)).ok ? true : undefined),
      server.printed,
    );

    const browser = await chromium.launch();
    t.onTestFinished(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Note that the local server has no live socket, so the panel falls back
    // to long polls, which over HTTP/1.1 hold all six of Chromium's
    // connections to the origin and starve Vite's module loads: Settings
    // would read "Reading…" forever. Answering the polls from here frees them.
    await context.route(/\/api\/live\//, async (route) => {
      try {
        await route.fulfill({ response: await route.fetch({ timeout: 0 }) });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    context.setDefaultTimeout(WAIT.PAGE_MS);
    const page = await context.newPage();
    await page.goto(`${origin}/app`);
    await seeded;

    // The local sign-in mints a session for the seeded member and lands on the web app.
    await page.goto(`${origin}/sign-in`);
    await page.getByRole("button", { name: /^Workspace: .*Personal workspace$/ }).waitFor();
    const personal = await query<{ slug: string }>(
      url,
      `select o.slug from personal_workspace p
         join "user" u on u.id = p.user_id
         join organization o on o.id = p.organization_id
       where u.email = $1`,
      [DEMO_EMAIL],
    );
    expect(personal).toHaveLength(1);
    const workspace = `${origin}/${personal[0]?.slug}`;

    await page.getByRole("textbox").first().waitFor();
    await page.getByRole("button", { name: "Choose a repository" }).first().click();
    await page.getByPlaceholder("Search repositories").waitFor();

    await page.goto(`${workspace}/settings/workspace`);
    await page.getByText("Workspace link").waitFor();
    await page.getByRole("button", { name: "Invite", exact: true }).waitFor();
  },
  CASE_TIMEOUT_MS,
);
