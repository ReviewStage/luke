import { eslintCompatPlugin } from "@oxlint/plugins";

import { enforceDeleteWithWhereRule } from "./rules/enforce-delete-with-where.ts";
import { enforceUpdateWithWhereRule } from "./rules/enforce-update-with-where.ts";
import { noAwaitDrizzleStatementRule } from "./rules/no-await-drizzle-statement.ts";
import { noLucideOutsideDoorRule } from "./rules/no-lucide-outside-door.ts";
import { noNodeTestRule } from "./rules/no-node-test.ts";
import { noRawAsyncPrimitivesRule } from "./rules/no-raw-async-primitives.ts";
import { noRawPressOutsideUiRule } from "./rules/no-raw-press-outside-ui.ts";
import { noRunPromiseOutsideEdgesRule } from "./rules/no-run-promise-outside-edges.ts";
import { skeletonThroughComponentsRule } from "./rules/skeleton-through-components.ts";

/**
 * Oxlint rules that catch code or tests that silently do nothing or wipe data,
 * and the design system's guards against controls built outside `@luke/ui` and
 * loading skeletons that copy the surface they stand for.
 */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "enforce-delete-with-where": enforceDeleteWithWhereRule,
    "enforce-update-with-where": enforceUpdateWithWhereRule,
    "no-await-drizzle-statement": noAwaitDrizzleStatementRule,
    "no-lucide-outside-door": noLucideOutsideDoorRule,
    "no-node-test": noNodeTestRule,
    "no-raw-async-primitives": noRawAsyncPrimitivesRule,
    "no-raw-press-outside-ui": noRawPressOutsideUiRule,
    "no-run-promise-outside-edges": noRunPromiseOutsideEdgesRule,
    "skeleton-through-components": skeletonThroughComponentsRule,
  },
});

export default antiSlopPlugin;
