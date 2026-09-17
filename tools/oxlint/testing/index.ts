import { eslintCompatPlugin } from "@oxlint/plugins";

import { noFocusOrRetryRule } from "./rules/no-focus-or-retry.ts";
import { noModuleMocksRule } from "./rules/no-module-mocks.ts";
import { noRealTimeRule } from "./rules/no-real-time.ts";
import { noRunnerRule } from "./rules/no-runner.ts";

/** The mechanical half of root AGENTS.md's "Testing" section, over test files alone. */
const testingPlugin = eslintCompatPlugin({
  meta: { name: "testing" },
  rules: {
    "no-focus-or-retry": noFocusOrRetryRule,
    "no-module-mocks": noModuleMocksRule,
    "no-real-time": noRealTimeRule,
    "no-runner": noRunnerRule,
  },
});

export default testingPlugin;
