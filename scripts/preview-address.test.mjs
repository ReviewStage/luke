import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "preview-address.sh");

const EXIT = {
  ADDRESS: 0,
  NOT_AFFECTED: 3,
  NOT_BUILT: 4,
  PROTECTED: 5,
  NOT_READY: 6,
  UNREADABLE: 7,
};
const SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO = "acme/luke";
const ADDRESS = "https://luke-git-branch-acme.vercel.app";
const SSO = "https://vercel.com/sso-api?url=…";
const FAKE_DIRECTORY_VARIABLE = "PREVIEW_ADDRESS_FAKE_DIRECTORY";
const RECORDS_FILE = "records.json";
const STATUSES_FILE = "statuses.json";
const REDIRECT_FILE = "redirect";
const RECORDS_CURSOR = "records-cursor";
const UNREADABLE = "UNREADABLE";

// The fake `gh` answers each deployments read with the next snapshot of the
// scenario, repeating the last, and the statuses read with the snapshot at
// the same index; `--jq` is applied with the real jq so the filter the script
// sends is the filter under test. The fake `curl` prints the redirect the
// scenario names, or nothing for an address that answers itself.
const FAKE_GH = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const directory = process.env.${FAKE_DIRECTORY_VARIABLE};
const args = process.argv.slice(2);
const jq = args[args.indexOf("--jq") + 1];
const read = (file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
const cursorPath = path.join(directory, "${RECORDS_CURSOR}");
let index = fs.existsSync(cursorPath) ? Number(fs.readFileSync(cursorPath, "utf8")) : 0;
if (args[1].endsWith("/status")) {
  process.stdout.write("pending: Vercel is deploying your app\n");
  process.exit(0);
}
const isRecords = args[1].split("?")[0].endsWith("/deployments");
if (isRecords) {
  fs.writeFileSync(cursorPath, String(index + 1));
} else {
  index -= 1;
}
const file = isRecords ? "${RECORDS_FILE}" : "${STATUSES_FILE}";
const scenario = read(file);
const answer = scenario[Math.min(index, scenario.length - 1)];
if (answer === "${UNREADABLE}") { process.stderr.write("gh: HTTP 502\n"); process.exit(1); }
const result = spawnSync("jq", ["-r", jq], { input: JSON.stringify(answer), encoding: "utf8" });
process.stdout.write(result.stdout);
process.exit(result.status);
`;

const FAKE_CURL = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const redirect = path.join(process.env.${FAKE_DIRECTORY_VARIABLE}, "${REDIRECT_FILE}");
if (fs.existsSync(redirect)) process.stdout.write(fs.readFileSync(redirect, "utf8"));
`;

function record(id, created) {
  return { id, environment: "Preview", sha: SHA, created_at: created };
}
function status(state, extra = {}) {
  return { state, created_at: "2026-09-18T10:00:00Z", ...extra };
}

// A repository whose first-parent history makes one commit per entry, each
// touching the one file it names, so a walk reads real trees; answers the
// commits' hashes, oldest first.
function commitHistory(directory, files) {
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet");
  return files.map((file, index) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), String(index));
    git("add", "--all");
    git(
      "-c",
      "user.name=Luke",
      "-c",
      "user.email=luke@example.com",
      "commit",
      "--quiet",
      "-m",
      file,
    );
    return git("rev-parse", "HEAD");
  });
}

function run({ records, statuses, redirect, history = [] }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "preview-address-"));
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  fs.writeFileSync(path.join(directory, RECORDS_FILE), JSON.stringify(records));
  fs.writeFileSync(path.join(directory, STATUSES_FILE), JSON.stringify(statuses));
  if (redirect !== undefined) fs.writeFileSync(path.join(directory, REDIRECT_FILE), redirect);
  const repository = path.join(directory, "repository");
  fs.mkdirSync(repository);
  const head = commitHistory(repository, history).at(-1) ?? SHA;
  const result = spawnSync("bash", [scriptPath, "--sha", head, "--repo", REPO], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      [FAKE_DIRECTORY_VARIABLE]: directory,
      PREVIEW_ADDRESS_INTERVAL_SECONDS: "0",
      PREVIEW_ADDRESS_ATTEMPTS: "3",
    },
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return result;
}

test("prints the newest Preview record's address once its newest status is success", () => {
  const result = run({
    records: [[record(1, "2026-09-18T09:00:00Z"), record(2, "2026-09-18T09:05:00Z")]],
    statuses: [
      [
        status("in_progress"),
        { ...status("success", { environment_url: ADDRESS }), created_at: "2026-09-18T10:01:00Z" },
      ],
    ],
  });
  assert.equal(result.status, EXIT.ADDRESS, result.stderr);
  assert.equal(result.stdout, `${ADDRESS}\n`);
});

test("waits through no record, a pending status, and a cancelled inactive one", () => {
  const result = run({
    records: [[], [record(2, "2026-09-18T09:05:00Z")], [record(2, "2026-09-18T09:05:00Z")]],
    statuses: [
      [],
      [status("inactive", { description: "Deployment has been cancelled" })],
      [status("success", { target_url: ADDRESS })],
    ],
  });
  assert.equal(result.status, EXIT.ADDRESS, result.stderr);
  assert.equal(result.stdout, `${ADDRESS}\n`);
  assert.match(
    result.stderr,
    /waiting \(no record yet .*Vercel says pending: Vercel is deploying your app\)/,
  );
});

test("a skipped head is served by its parent's preview", () => {
  const result = run({
    history: ["apps/web/server.ts", "apps/desktop/main.ts"],
    records: [[record(2, "2026-09-18T09:05:00Z")], [record(1, "2026-09-18T09:00:00Z")]],
    statuses: [
      [status("inactive", { description: "Skipped - Not affected" })],
      [status("success", { environment_url: ADDRESS })],
    ],
  });
  assert.equal(result.status, EXIT.ADDRESS, result.stderr);
  assert.equal(result.stdout, `${ADDRESS}\n`);
});

test("the walk passes over an ancestor pushed without a record of its own", () => {
  const result = run({
    history: ["apps/web/server.ts", "apps/desktop/main.ts", "apps/desktop/panel.ts"],
    records: [[record(3, "2026-09-18T09:10:00Z")], [], [record(1, "2026-09-18T09:00:00Z")]],
    statuses: [
      [status("inactive", { description: "Skipped - Not affected" })],
      [],
      [status("success", { environment_url: ADDRESS })],
    ],
  });
  assert.equal(result.status, EXIT.ADDRESS, result.stderr);
  assert.equal(result.stdout, `${ADDRESS}\n`);
});

test("a skipped head whose deployed tree no preview was built from is NOT_AFFECTED", () => {
  const result = run({
    history: ["apps/web/server.ts", "apps/web/routes.ts", "apps/desktop/main.ts"],
    records: [[record(3, "2026-09-18T09:10:00Z")], [], [record(1, "2026-09-18T09:00:00Z")]],
    statuses: [
      [status("inactive", { description: "Skipped - Not affected" })],
      [],
      [status("success", { environment_url: ADDRESS })],
    ],
  });
  assert.equal(result.status, EXIT.NOT_AFFECTED, result.stderr);
  assert.equal(result.stdout, "");
});

test("a failed build is NOT_BUILT", () => {
  const result = run({
    records: [[record(2, "2026-09-18T09:05:00Z")]],
    statuses: [[status("failure", { description: "Build failed" })]],
  });
  assert.equal(result.status, EXIT.NOT_BUILT);
  assert.match(result.stderr, /Build failed/);
});

test("a preview redirecting to Vercel SSO is PROTECTED and its address is not printed", () => {
  const result = run({
    records: [[record(2, "2026-09-18T09:05:00Z")]],
    statuses: [[status("success", { environment_url: ADDRESS })]],
    redirect: SSO,
  });
  assert.equal(result.status, EXIT.PROTECTED);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Deployment Protection/);
});

test("a record that never settles within the wait is NOT_READY", () => {
  const result = run({
    records: [[record(2, "2026-09-18T09:05:00Z")]],
    statuses: [[status("queued")]],
  });
  assert.equal(result.status, EXIT.NOT_READY);
});

test("a gh that will not answer is UNREADABLE", () => {
  const result = run({ records: [UNREADABLE], statuses: [[]] });
  assert.equal(result.status, EXIT.UNREADABLE);
});
