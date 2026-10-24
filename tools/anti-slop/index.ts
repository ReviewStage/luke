import { eslintCompatPlugin } from "@oxlint/plugins";

import { asyncPressNeedsBusyRule } from "./rules/async-press-needs-busy.ts";
import { enforceDeleteWithWhereRule } from "./rules/enforce-delete-with-where.ts";
import { enforceUpdateWithWhereRule } from "./rules/enforce-update-with-where.ts";
import { noAwaitDrizzleStatementRule } from "./rules/no-await-drizzle-statement.ts";
import { noDocumentPressListenerRule } from "./rules/no-document-press-listener.ts";
import { noHandWrittenArrowKeysRule } from "./rules/no-hand-written-arrow-keys.ts";
import { noHandWrittenLiveRegionRule } from "./rules/no-hand-written-live-region.ts";
import { noLucideOutsideDoorRule } from "./rules/no-lucide-outside-door.ts";
import { noNodeTestRule } from "./rules/no-node-test.ts";
import { noOpenPageFromButtonRule } from "./rules/no-open-page-from-button.ts";
import { noRawAsyncPrimitivesRule } from "./rules/no-raw-async-primitives.ts";
import { noRawHeadingOutsideUiRule } from "./rules/no-raw-heading-outside-ui.ts";
import { noRawPressOutsideUiRule } from "./rules/no-raw-press-outside-ui.ts";
import { noRunPromiseOutsideEdgesRule } from "./rules/no-run-promise-outside-edges.ts";
import { retiredRule } from "./rules/retired.ts";
import { skeletonThroughComponentsRule } from "./rules/skeleton-through-components.ts";

/**
 * Oxlint rules that catch code or tests that silently do nothing or wipe data,
 * and the design system's guards against controls and headings built outside `@luke/ui`,
 * loading skeletons that copy the surface they stand for, buttons that wait on a press without saying so, buttons that open a page,
 * popovers that close on a press through a listener of their own, and the
 * classes, glyphs and patterns phase 2 retired coming back.
 */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "async-press-needs-busy": asyncPressNeedsBusyRule,
    "enforce-delete-with-where": enforceDeleteWithWhereRule,
    "enforce-update-with-where": enforceUpdateWithWhereRule,
    "no-await-drizzle-statement": noAwaitDrizzleStatementRule,
    "no-document-press-listener": noDocumentPressListenerRule,
    "no-hand-written-arrow-keys": noHandWrittenArrowKeysRule,
    "no-hand-written-live-region": noHandWrittenLiveRegionRule,
    "no-lucide-outside-door": noLucideOutsideDoorRule,
    "no-node-test": noNodeTestRule,
    "no-open-page-from-button": noOpenPageFromButtonRule,
    "no-raw-async-primitives": noRawAsyncPrimitivesRule,
    "no-raw-heading-outside-ui": noRawHeadingOutsideUiRule,
    "no-raw-press-outside-ui": noRawPressOutsideUiRule,
    "no-run-promise-outside-edges": noRunPromiseOutsideEdgesRule,
    retired: retiredRule,
    "skeleton-through-components": skeletonThroughComponentsRule,
  },
});

export default antiSlopPlugin;
