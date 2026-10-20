import { eslintCompatPlugin } from "@oxlint/plugins";

import { enforceDeleteWithWhereRule } from "./rules/enforce-delete-with-where.ts";
import { enforceUpdateWithWhereRule } from "./rules/enforce-update-with-where.ts";
import { noAwaitDrizzleStatementRule } from "./rules/no-await-drizzle-statement.ts";
import { noNodeTestRule } from "./rules/no-node-test.ts";
import { noRawAsyncPrimitivesRule } from "./rules/no-raw-async-primitives.ts";
import { noRunPromiseOutsideEdgesRule } from "./rules/no-run-promise-outside-edges.ts";

/** Oxlint rules that catch code or tests that silently do nothing or wipe data. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "enforce-delete-with-where": enforceDeleteWithWhereRule,
    "enforce-update-with-where": enforceUpdateWithWhereRule,
    "no-await-drizzle-statement": noAwaitDrizzleStatementRule,
    "no-node-test": noNodeTestRule,
    "no-raw-async-primitives": noRawAsyncPrimitivesRule,
    "no-run-promise-outside-edges": noRunPromiseOutsideEdgesRule,
  },
});

export default antiSlopPlugin;
