import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oxlintPath = path.join(repositoryRoot, "node_modules", ".bin", "oxlint");
const pluginPath = path.join(repositoryRoot, "tools", "oxlint", "anti-slop", "index.ts");

async function lintFixture(rule, source) {
  const directory = await mkdtemp(path.join(tmpdir(), "luke-anti-slop-"));
  const configPath = path.join(directory, ".oxlintrc.json");
  const fixturePath = path.join(directory, "fixture.ts");
  await writeFile(
    configPath,
    `${JSON.stringify({
      jsPlugins: [{ name: "anti-slop", specifier: pluginPath }],
      rules: { [`anti-slop/${rule}`]: "error" },
    })}\n`,
  );
  await writeFile(fixturePath, source);

  try {
    const result = await execFileAsync(oxlintPath, ["--config", configPath, fixturePath]);
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    return {
      exitCode: error.code,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("a safety comment on an exported variable justifies its assertion", async () => {
  const result = await lintFixture(
    "require-safety-comment-for-type-assertion",
    `declare const source: unknown;\n// SAFETY: the fixture establishes the value's contract.\nexport const value = source as string;\n`,
  );

  assert.equal(result.exitCode, 0, result.output);
});

test("an exported variable without a safety comment is still rejected", async () => {
  const result = await lintFixture(
    "require-safety-comment-for-type-assertion",
    "declare const source: unknown;\nexport const value = source as string;\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /SAFETY:/u);
});

test("a parenthesized empty-object branch is rejected", async () => {
  const result = await lintFixture(
    "no-conditional-empty-object-spread",
    "declare const condition: boolean;\nconst value = { ...(condition ? ({}) : { answer: 42 }) };\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /conditional spread hides property omission/u);
});

test("staged JavaScript formatting finishes before Oxlint starts", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

  assert.deepEqual(packageJson["lint-staged"]["*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}"], [
    "biome check --write --no-errors-on-unmatched",
    "oxlint --no-error-on-unmatched-pattern",
  ]);
});

test("a parenthesized assertion chain reports only its outer widening", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    "const value = { answer: 42 };\nconst widened = (value as unknown) as object;\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.equal(result.output.match(/explicit .* type on assertion/gu)?.length, 1, result.output);
});

test("a precise inline mapped type preserves known value evidence", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    'const value = { answer: 42 };\nconst mapped = value as { [Key in "answer"]: number };\n',
  );

  assert.equal(result.exitCode, 0, result.output);
});

test("a broad inline mapped type still discards known value evidence", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    "const value = { answer: 42 };\nconst mapped = value as { [Key in string]: number };\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /explicit open dictionary type on assertion/u);
});

test("a precise Record preserves known value evidence", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    'type AnswerRecord = Record<"answer", number>;\nconst value = { answer: 42 };\nconst direct = value as Record<"answer", number>;\nconst aliased: AnswerRecord = value;\n',
  );

  assert.equal(result.exitCode, 0, result.output);
});

test("a broad Record still discards known value evidence", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    "type OpenRecord = Record<string, number>;\nconst value = { answer: 42 };\nconst direct = value as Record<string, number>;\nconst aliased: OpenRecord = value;\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.equal(result.output.match(/explicit open dictionary type/gu)?.length, 2, result.output);
});

test("an unknown union cannot hide behind a type alias", async () => {
  const result = await lintFixture("no-unknown-type-aliases", "type Hidden = unknown | string;\n");

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /hides `unknown`/u);
});

test("unknown parameters cannot hide behind parentheses or unions", async () => {
  const result = await lintFixture(
    "no-unknown-parameters",
    "function parenthesized(value: (unknown)) {}\nfunction union(value: unknown | string) {}\nfunction enrich(cause: unknown | string) {}\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.equal(result.output.match(/leaves input unparsed/gu)?.length, 2, result.output);
});

test("a closed interface preserves known value evidence", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    "interface Answer { answer: number }\nconst value = { answer: 42 };\nconst assigned: Answer = value;\nconst asserted = value as Answer;\n",
  );

  assert.equal(result.exitCode, 0, result.output);
});

test("an open interface discards known value evidence", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    "interface Answers { [key: string]: number }\nconst value = { answer: 42 };\nconst assigned: Answers = value;\nconst asserted = value as Answers;\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.equal(result.output.match(/explicit open dictionary type/gu)?.length, 2, result.output);
});

test("an interface inherits openness from interfaces and aliases", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    "interface OpenBase { [key: string]: number }\ninterface InterfaceChild extends OpenBase {}\ntype OpenAlias = Record<string, number>;\ninterface AliasChild extends OpenAlias {}\nconst value = { answer: 42 };\nconst first: InterfaceChild = value;\nconst second: AliasChild = value;\n",
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.equal(result.output.match(/explicit open dictionary type/gu)?.length, 2, result.output);
});

test("an interface with only closed ancestors preserves evidence", async () => {
  const result = await lintFixture(
    "no-known-value-widening",
    "interface ClosedBase { answer: number }\ninterface ClosedChild extends ClosedBase {}\nconst value = { answer: 42 };\nconst assigned: ClosedChild = value;\n",
  );

  assert.equal(result.exitCode, 0, result.output);
});
