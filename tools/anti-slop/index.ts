import { eslintCompatPlugin } from "@oxlint/plugins";

import { asyncPressNeedsBusyRule } from "./rules/async-press-needs-busy.ts";
import { enforceDeleteWithWhereRule } from "./rules/enforce-delete-with-where.ts";
import { enforceUpdateWithWhereRule } from "./rules/enforce-update-with-where.ts";
import { noAwaitDrizzleStatementRule } from "./rules/no-await-drizzle-statement.ts";
import { noLucideOutsideDoorRule } from "./rules/no-lucide-outside-door.ts";
import { noNodeTestRule } from "./rules/no-node-test.ts";
import { noOpenPageFromButtonRule } from "./rules/no-open-page-from-button.ts";
import { noRawAsyncPrimitivesRule } from "./rules/no-raw-async-primitives.ts";
import { noRawPressOutsideUiRule } from "./rules/no-raw-press-outside-ui.ts";
import { noRunPromiseOutsideEdgesRule } from "./rules/no-run-promise-outside-edges.ts";
import { retiredRule } from "./rules/retired.ts";
import { skeletonThroughComponentsRule } from "./rules/skeleton-through-components.ts";

/**
 * Oxlint rules that catch code or tests that silently do nothing or wipe data,
 * and the design system's guards against controls built outside `@luke/ui`,
 * loading skeletons that copy the surface they stand for, buttons that wait on a press without saying so, buttons that open a page, and the classes,
 * glyphs and patterns phase 2 retired coming back.
 */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "async-press-needs-busy": asyncPressNeedsBusyRule,
    "enforce-delete-with-where": enforceDeleteWithWhereRule,
    "enforce-update-with-where": enforceUpdateWithWhereRule,
    "no-await-drizzle-statement": noAwaitDrizzleStatementRule,
    "no-lucide-outside-door": noLucideOutsideDoorRule,
    "no-node-test": noNodeTestRule,
    "no-open-page-from-button": noOpenPageFromButtonRule,
    "no-raw-async-primitives": noRawAsyncPrimitivesRule,
    "no-raw-press-outside-ui": noRawPressOutsideUiRule,
    "no-run-promise-outside-edges": noRunPromiseOutsideEdgesRule,
    retired: retiredRule,
    "skeleton-through-components": skeletonThroughComponentsRule,
  },
});

export default antiSlopPlugin;
