// verify-ci.mjs -- whether a commit is on main and passed every check main's rules require.

import { spawnSync } from "node:child_process";

// A tagged release builds the commit its tag names without running CI's
// checks again, so this is what stands in for them. It asks GitHub the
// question the merge queue answered before it let the commit onto main: is
// the commit on the branch, and has every status check the branch's rules
// require succeeded on it, reported by the app the rule names? A commit that
// reached main through the queue answers yes; one tagged beside main, or one
// whose checks failed or never ran, answers no. Anything this cannot read
// counts as no, so a missing permission or an outage fails closed.
//
// Usage: node scripts/release/verify-ci.mjs <owner/name> <commit>, with `gh`
// signed in (GH_TOKEN in Actions). It exits 0 when the commit passed and 1,
// naming every reason, when it did not.

const BRANCH = "main";
const RULE_TYPE = { REQUIRED_STATUS_CHECKS: "required_status_checks" };
const CONCLUSION = { SUCCESS: "success" };
const COMPARE_STATUS = { IDENTICAL: "identical", AHEAD: "ahead" };
// A comparison carries every file patch between the commit and the branch's
// head, megabytes once main has moved on, far past spawnSync's 1 MiB default.
const ANSWER_LIMIT_BYTES = 256 * 1024 * 1024;

function api(path) {
  const ran = spawnSync("gh", ["api", path], { encoding: "utf8", maxBuffer: ANSWER_LIMIT_BYTES });
  if (ran.status !== 0) {
    throw new Error(`gh api ${path} failed: ${(ran.stderr ?? "").trim() || `exit ${ran.status}`}`);
  }
  return JSON.parse(ran.stdout);
}

/** The status checks every rule on the branch requires, each a context and the app that must report it. */
function requiredChecks(repository) {
  return api(`repos/${repository}/rules/branches/${BRANCH}`)
    .filter((rule) => rule.type === RULE_TYPE.REQUIRED_STATUS_CHECKS)
    .flatMap((rule) => rule.parameters.required_status_checks);
}

// Note that the comparison runs from the commit to the branch, so "ahead"
// means the branch has moved on past the commit, which is still on it.
function onBranch(repository, commit) {
  const { status } = api(`repos/${repository}/compare/${commit}...${BRANCH}?per_page=1`);
  return status === COMPARE_STATUS.IDENTICAL || status === COMPARE_STATUS.AHEAD;
}

// Note that every latest run of the check must have succeeded, not merely
// one, because a re-run that failed outranks the success it replaced.
function passed(repository, commit, check) {
  const name = encodeURIComponent(check.context);
  const { check_runs: runs } = api(
    `repos/${repository}/commits/${commit}/check-runs?check_name=${name}&filter=latest&per_page=100`,
  );
  const reported =
    check.integration_id === undefined
      ? runs
      : runs.filter((run) => run.app?.id === check.integration_id);
  return reported.length > 0 && reported.every((run) => run.conclusion === CONCLUSION.SUCCESS);
}

function problemsWith(repository, commit) {
  const required = requiredChecks(repository);
  const problems = [];
  if (required.length === 0) {
    problems.push(`${BRANCH}'s rules require no status check, so nothing vouches for ${commit}`);
  }
  if (!onBranch(repository, commit)) {
    problems.push(`${commit} is not on ${BRANCH}`);
  }
  for (const check of required) {
    if (!passed(repository, commit, check)) {
      problems.push(`the required check "${check.context}" has not succeeded on ${commit}`);
    }
  }
  return { required, problems };
}

const [repository, commit, ...rest] = process.argv.slice(2);
if (!repository || !commit || rest.length > 0) {
  process.stderr.write("usage: verify-ci.mjs <owner/name> <commit>\n");
  process.exit(2);
}
try {
  const { required, problems } = problemsWith(repository, commit);
  if (problems.length > 0) {
    process.stderr.write(`${problems.map((problem) => `error: ${problem}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    const names = required.map((check) => check.context).join(", ");
    process.stdout.write(`${commit} is on ${BRANCH} and passed every required check: ${names}\n`);
  }
} catch (error) {
  process.stderr.write(`error: could not confirm CI for ${commit}: ${error.message}\n`);
  process.exitCode = 1;
}
