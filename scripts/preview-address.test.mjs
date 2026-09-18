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

function run({ records, statuses, redirect }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "preview-address-"));
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  fs.writeFileSync(path.join(directory, RECORDS_FILE), JSON.stringify(records));
  fs.writeFileSync(path.join(directory, STATUSES_FILE), JSON.stringify(statuses));
  if (redirect !== undefined) fs.writeFileSync(path.join(directory, REDIRECT_FILE), redirect);
  const result = spawnSync("bash", [scriptPath, "--sha", SHA, "--repo", REPO], {
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

test("a build Vercel skipped is NOT_AFFECTED, not waited on", () => {
  const result = run({
    records: [[record(2, "2026-09-18T09:05:00Z")]],
    statuses: [[status("inactive", { description: "Skipped - Not affected" })]],
  });
  assert.equal(result.status, EXIT.NOT_AFFECTED);
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
