import path from "node:path";
import { fileURLToPath } from "node:url";

import { ruleFixtureTests } from "../rules-harness.mjs";

// The rules gate on a test file's own extension, so the fixtures carry it.
ruleFixtureTests({
  pluginDirectory: path.dirname(fileURLToPath(import.meta.url)),
  pluginName: "testing",
  fixtureSuffix: ".test.ts",
});
