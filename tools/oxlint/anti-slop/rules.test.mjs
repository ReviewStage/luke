import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every anti-slop rule is exercised against a pair of fixtures: one file the
 * rule must report and one it must leave alone. A rule with no pair, or a pair
 * with no rule, fails here — the rules are the executable style policy, so a
 * rewrite that silently stops reporting is a change nothing else would catch.
 *
 * The fixtures run through oxlint itself rather than a stubbed rule context:
 * the plugin's own loader, visitor keys, and scope analysis are most of what
 * these rules stand on, and none of it is exercised by calling `createOnce`.
 */
const PLUGIN_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIRECTORY = path.join(PLUGIN_DIRECTORY, "fixtures");
const REPOSITORY_ROOT = path.resolve(PLUGIN_DIRECTORY, "..", "..", "..");
// The config's own `specifier` is resolved against the config file, but the
// paths oxlint lints are resolved against the working directory, so the run is
// pinned to the repository root rather than to wherever `node --test` started.
const FIXTURE_CONFIG = path.join(PLUGIN_DIRECTORY, "fixtures.oxlintrc.json");

function ruleNames(configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return Object.keys(config.rules ?? {})
    .filter((rule) => rule.startsWith("anti-slop/"))
    .map((rule) => rule.slice("anti-slop/".length))
    .sort();
}

function reportedRules() {
  const oxlint = path.join(REPOSITORY_ROOT, "node_modules", ".bin", "oxlint");
  let output = "";
  try {
    output = execFileSync(
      oxlint,
      ["--config", FIXTURE_CONFIG, "--format", "json", FIXTURES_DIRECTORY],
      { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (failure) {
    // A reported fixture exits non-zero, which is the expected outcome for
    // every invalid one; only a run that produced no report is a real failure.
    output = failure.stdout ?? "";
    assert.notEqual(output, "", `oxlint reported nothing it could parse: ${failure.stderr ?? ""}`);
  }

  const byFixture = new Map();
  for (const diagnostic of JSON.parse(output).diagnostics) {
    const rule = /^anti-slop\((?<rule>[^)]+)\)$/u.exec(diagnostic.code)?.groups?.rule;
    if (rule === undefined) continue;
    const fixture = path.basename(diagnostic.filename);
    byFixture.set(fixture, [...(byFixture.get(fixture) ?? []), rule].sort());
  }
  return byFixture;
}

const RULES = ruleNames(path.join(REPOSITORY_ROOT, ".oxlintrc.json"));
const REPORTED = reportedRules();

test("the repository enables every rule the plugin registers, and no other", () => {
  const registered = readdirSync(path.join(PLUGIN_DIRECTORY, "rules"))
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => entry.slice(0, -".ts".length))
    .sort();

  assert.deepEqual(RULES, registered);
});

test("every rule carries a fixture it reports and one it leaves alone", () => {
  const fixtures = readdirSync(FIXTURES_DIRECTORY).sort();
  const expected = RULES.flatMap((rule) => [`${rule}.invalid.ts`, `${rule}.valid.ts`]).sort();

  assert.deepEqual(fixtures, expected);
});

for (const rule of RULES) {
  test(`${rule} reports the pattern it exists to reject`, () => {
    assert.deepEqual(REPORTED.get(`${rule}.invalid.ts`), [rule]);
  });

  test(`${rule} leaves the shape it asks for alone`, () => {
    assert.equal(REPORTED.get(`${rule}.valid.ts`), undefined);
  });
}
