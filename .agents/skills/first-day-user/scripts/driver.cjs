// driver.cjs -- one persistent Chromium for a first-day run, driven through a file queue so every later command steers the same browser.
//
// Each `<run>/queue/in/<name>.js` is moved to `queue/running/` and run once
// as the body of an async function given `page`, `context`, `shot(name,
// options)`, `sql(text, params)`, `origin`, and `setPage(page)`; what it
// returns, what it threw, the page's address, and the console errors it raised
// are written to `<run>/queue/out/<name>.json`, and its file leaves
// `running/`. Its deadline, `STEP_DEADLINE_MS`, counts from when it was
// queued: a step that waited past it is answered as expired without running,
// and one still running at it is answered as timed out while the queue moves
// on. A `quit.js` stops the driver.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { Client } = require(process.argv[3]);

const RUN = process.argv[2];
const ORIGIN = process.env.FIRST_DAY_ORIGIN;
const QUEUE = {
  IN: path.join(RUN, "queue", "in"),
  RUNNING: path.join(RUN, "queue", "running"),
  OUT: path.join(RUN, "queue", "out"),
};
const POLL_MS = 200;
const STEP_TIMEOUT_MS = 8000;
const NAVIGATION_TIMEOUT_MS = 60000;
/** Matches `step.sh`'s default wait, so a caller that gave up is never answered later. */
const STEP_DEADLINE_MS = 115000;
const LOG_CHARS = 400;
const AsyncFunction = (async () => {}).constructor;

async function sql(text, params = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

function watchConsole(page, logs) {
  page.on("console", (message) => {
    if (message.type() === "error") logs.push(`error: ${message.text()}`.slice(0, LOG_CHARS));
  });
  page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`.slice(0, LOG_CHARS)));
}

function answerText(out) {
  try {
    return JSON.stringify(out, null, 2);
  } catch (error) {
    const reason = `the step's result could not be written as JSON: ${error?.message ?? error}`;
    return JSON.stringify({ name: out.name, error: reason, url: out.url, logs: out.logs }, null, 2);
  }
}

// Note that a body past its deadline cannot be stopped, only left: it may
// still act on the page, which the answer says so the caller looks first.
function bounded(promise, remainingMs) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the step ran past ${STEP_DEADLINE_MS} ms and was left running`)),
      remainingMs,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function runStep(file, state) {
  const name = file.replace(/\.js$/, "");
  const running = path.join(QUEUE.RUNNING, file);
  // Note that `step.sh` takes back a step it gave up on, which may land between the listing and this claim.
  try {
    fs.renameSync(path.join(QUEUE.IN, file), running);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const code = fs.readFileSync(running, "utf8");
  // Note that `step.sh` writes the step as it queues it, so its file's time is when the caller started waiting.
  const remainingMs = STEP_DEADLINE_MS - (Date.now() - fs.statSync(running).mtimeMs);
  state.logs.length = 0;
  const shot = async (shotName, options = {}) => {
    const target = path.join(RUN, "shots", `${shotName}.png`);
    await state.page.screenshot({ path: target, ...options });
    return target;
  };
  const out = { name };
  try {
    if (remainingMs <= 0) throw new Error(`the step waited past ${STEP_DEADLINE_MS} ms in the queue and was not run`);
    const body = new AsyncFunction("page", "context", "shot", "sql", "origin", "setPage", code);
    out.result = await bounded(
      body(state.page, state.context, shot, sql, ORIGIN, (page) => {
        state.page = page;
      }),
      remainingMs,
    );
  } catch (error) {
    out.error = String(error?.stack ?? error).slice(0, 2000);
  }
  out.url = state.page.url();
  out.logs = [...state.logs];
  fs.writeFileSync(path.join(QUEUE.OUT, `${name}.json`), answerText(out));
  fs.unlinkSync(running);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Note that the local server has no live socket, so the panel falls back to
  // long polls, which over HTTP/1.1 take all six of Chromium's connections to
  // the origin and starve Vite's module loads: Settings and Automations then
  // read "Reading…" forever. Answering the polls from Node frees the pool.
  await context.route(/\/api\/live\//, async (route) => {
    try {
      await route.fulfill({ response: await route.fetch({ timeout: 0 }) });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  // Note that Vite compiles the panel on its first load, which takes far longer than a click.
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  const state = { context, page: await context.newPage(), logs: [] };
  watchConsole(state.page, state.logs);
  context.on("page", (page) => watchConsole(page, state.logs));
  console.log("[stack] ready");
  for (;;) {
    const files = fs
      .readdirSync(QUEUE.IN)
      .filter((file) => file.endsWith(".js"))
      .sort();
    if (files.includes("quit.js")) break;
    for (const file of files) await runStep(file, state);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  await browser.close();
}

main();
