import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_PIN } from "../src/pins.ts";

const CODEX_PACKAGE = `@openai/codex@${CODEX_PIN.VERSION}`;

const BUNDLED_MODELS_URL = `https://raw.githubusercontent.com/openai/codex/rust-v${CODEX_PIN.VERSION}/codex-rs/models-manager/models.json`;

const GENERATED_FROM = [
  "// generated-from.ts -- the Codex these types were generated from (`scripts/generate-codex-protocol.mjs`).",
  "",
  `export const CODEX_PROTOCOL_VERSION = "${CODEX_PIN.VERSION}";`,
  "",
].join("\n");

function bundledModelsModule(text) {
  return [
    "// bundled-models.ts -- the model catalog the Codex these types were generated from bundles (`scripts/generate-codex-protocol.mjs`).",
    "",
    `export const CODEX_BUNDLED_MODELS_JSON = ${JSON.stringify(text)};`,
    "",
  ].join("\n");
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(packageRoot, "src", "codex-protocol");

function typeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const scratch = mkdtempSync(path.join(tmpdir(), "codex-protocol-"));
try {
  execFileSync("npx", ["--yes", CODEX_PACKAGE, "app-server", "generate-ts", "--out", scratch], {
    stdio: "inherit",
  });
  for (const file of typeScriptFiles(scratch)) {
    const text = readFileSync(file, "utf8").replace(/from "(\.\.?\/[^"]*)"/gu, (_, specifier) => {
      const resolved = path.resolve(path.dirname(file), specifier);
      const isDirectory = existsSync(resolved) && statSync(resolved).isDirectory();
      return `from "${specifier}${isDirectory ? "/index" : ""}.js"`;
    });
    writeFileSync(file, text);
  }
  const models = await fetch(BUNDLED_MODELS_URL);
  if (!models.ok) throw new Error(`${BUNDLED_MODELS_URL} answered ${models.status}`);
  const modelsText = await models.text();
  if (!(JSON.parse(modelsText).models?.length > 0))
    throw new Error("the bundled catalog lists no model");
  writeFileSync(path.join(scratch, "bundled-models.ts"), bundledModelsModule(modelsText));
  writeFileSync(path.join(scratch, "generated-from.ts"), GENERATED_FROM);
  rmSync(target, { recursive: true, force: true });
  execFileSync("cp", ["-R", scratch, target]);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
