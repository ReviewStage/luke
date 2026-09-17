import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Every rule of a plugin is exercised against a pair of fixtures: one file the
 * rule must report — as many times as that file shows the pattern, which is
 * what lets one fixture carry every shape a rule matches — and one it must
 * leave alone. A rule with no pair, or a pair with no rule, fails here — the
 * rules are the executable style policy, so a rewrite that silently stops
 * reporting is a change nothing else would catch.
 *
 * The fixtures run through oxlint itself rather than a stubbed rule context:
 * the plugin's own loader, visitor keys, and scope analysis are most of what
 * these rules stand on, and none of it is exercised by calling `createOnce`.
 *
 * `fixtureSuffix` is what a fixture's name ends in after `<rule>.invalid` or
 * `<rule>.valid`: `.ts` for a plugin over every source file, `.test.ts` for
 * one whose rules gate on a test file's own extension.
 */
export function ruleFixtureTests({ pluginDirectory, pluginName, fixtureSuffix = ".ts" }) {
  const fixturesDirectory = path.join(pluginDirectory, "fixtures");
  const repositoryRoot = path.resolve(pluginDirectory, "..", "..", "..");
  // The config's own `specifier` is resolved against the config file, but the
  // paths oxlint lints are resolved against the working directory, so the run
  // is pinned to the repository root rather than to wherever `node --test`
  // started.
  const fixtureConfig = path.join(pluginDirectory, "fixtures.oxlintrc.json");
  const prefix = `${pluginName}/`;

  function ruleNames(configPath) {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return Object.keys(config.rules ?? {})
      .filter((rule) => rule.startsWith(prefix))
      .map((rule) => rule.slice(prefix.length))
      .sort();
  }

  function reportedRules() {
    const oxlint = path.join(repositoryRoot, "node_modules", ".bin", "oxlint");
    let output = "";
    try {
      output = execFileSync(
        oxlint,
        ["--config", fixtureConfig, "--format", "json", fixturesDirectory],
        { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (failure) {
      // A reported fixture exits non-zero, which is the expected outcome for
      // every invalid one; only a run that produced no report is a real failure.
      output = failure.stdout ?? "";
      assert.notEqual(
        output,
        "",
        `oxlint reported nothing it could parse: ${failure.stderr ?? ""}`,
      );
    }

    const code = new RegExp(`^${pluginName}\\((?<rule>[^)]+)\\)$`, "u");
    const byFixture = new Map();
    for (const diagnostic of JSON.parse(output).diagnostics) {
      const rule = code.exec(diagnostic.code)?.groups?.rule;
      if (rule === undefined) continue;
      const fixture = path.basename(diagnostic.filename);
      byFixture.set(fixture, [...new Set([...(byFixture.get(fixture) ?? []), rule])].sort());
    }
    return byFixture;
  }

  const rules = ruleNames(path.join(repositoryRoot, ".oxlintrc.json"));
  const reported = reportedRules();

  test(`${pluginName}: the fixture run enables exactly the rules the repository does`, () => {
    assert.deepEqual(ruleNames(fixtureConfig), rules);
  });

  test(`${pluginName}: the repository enables every rule the plugin registers, and no other`, () => {
    const registered = readdirSync(path.join(pluginDirectory, "rules"))
      .filter((entry) => entry.endsWith(".ts"))
      .map((entry) => entry.slice(0, -".ts".length))
      .sort();

    assert.deepEqual(rules, registered);
  });

  test(`${pluginName}: every rule carries a fixture it reports and one it leaves alone`, () => {
    const fixtures = readdirSync(fixturesDirectory).sort();
    const expected = rules
      .flatMap((rule) => [`${rule}.invalid${fixtureSuffix}`, `${rule}.valid${fixtureSuffix}`])
      .sort();

    assert.deepEqual(fixtures, expected);
  });

  for (const rule of rules) {
    test(`${pluginName}/${rule} reports the pattern it exists to reject`, () => {
      assert.deepEqual(reported.get(`${rule}.invalid${fixtureSuffix}`), [rule]);
    });

    test(`${pluginName}/${rule} leaves the shape it asks for alone`, () => {
      assert.equal(reported.get(`${rule}.valid${fixtureSuffix}`), undefined);
    });
  }
}
