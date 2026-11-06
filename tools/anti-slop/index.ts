import { eslintCompatPlugin } from "@oxlint/plugins";

import { asyncPressNeedsBusyRule } from "./rules/async-press-needs-busy.ts";
import { enforceDeleteWithWhereRule } from "./rules/enforce-delete-with-where.ts";
import { enforceUpdateWithWhereRule } from "./rules/enforce-update-with-where.ts";
import { noAwaitDrizzleStatementRule } from "./rules/no-await-drizzle-statement.ts";
import { noBrowserFormValidationRule } from "./rules/no-browser-form-validation.ts";
import { noDirectViewStorageRule } from "./rules/no-direct-view-storage.ts";
import { noDocumentPressListenerRule } from "./rules/no-document-press-listener.ts";
import { noFocusedOrSkippedTestRule } from "./rules/no-focused-or-skipped-test.ts";
import { noFollowOutsideHostReadRule } from "./rules/no-follow-outside-host-read.ts";
import { noHandWrittenArrowKeysRule } from "./rules/no-hand-written-arrow-keys.ts";
import { noHandWrittenLiveRegionRule } from "./rules/no-hand-written-live-region.ts";
import { noInternalViMockRule } from "./rules/no-internal-vi-mock.ts";
import { noLucideOutsideDoorRule } from "./rules/no-lucide-outside-door.ts";
import { noNodeTestRule } from "./rules/no-node-test.ts";
import { noOpenPageFromButtonRule } from "./rules/no-open-page-from-button.ts";
import { noPlaceholderEllipsisRule } from "./rules/no-placeholder-ellipsis.ts";
import { noProductNameRule } from "./rules/no-product-name.ts";
import { noRawAsyncPrimitivesRule } from "./rules/no-raw-async-primitives.ts";
import { noRawHeadingOutsideUiRule } from "./rules/no-raw-heading-outside-ui.ts";
import { noRawPressOutsideUiRule } from "./rules/no-raw-press-outside-ui.ts";
import { noReducedMotionQueryRule } from "./rules/no-reduced-motion-query.ts";
import { noRunPromiseOutsideEdgesRule } from "./rules/no-run-promise-outside-edges.ts";
import { noShadcnFocusRingRule } from "./rules/no-shadcn-focus-ring.ts";
import { noSourceReadInTestRule } from "./rules/no-source-read-in-test.ts";
import { retiredRule } from "./rules/retired.ts";
import { skeletonThroughComponentsRule } from "./rules/skeleton-through-components.ts";

const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "async-press-needs-busy": asyncPressNeedsBusyRule,
    "enforce-delete-with-where": enforceDeleteWithWhereRule,
    "enforce-update-with-where": enforceUpdateWithWhereRule,
    "no-await-drizzle-statement": noAwaitDrizzleStatementRule,
    "no-browser-form-validation": noBrowserFormValidationRule,
    "no-direct-view-storage": noDirectViewStorageRule,
    "no-document-press-listener": noDocumentPressListenerRule,
    "no-focused-or-skipped-test": noFocusedOrSkippedTestRule,
    "no-follow-outside-host-read": noFollowOutsideHostReadRule,
    "no-hand-written-arrow-keys": noHandWrittenArrowKeysRule,
    "no-hand-written-live-region": noHandWrittenLiveRegionRule,
    "no-internal-vi-mock": noInternalViMockRule,
    "no-lucide-outside-door": noLucideOutsideDoorRule,
    "no-node-test": noNodeTestRule,
    "no-open-page-from-button": noOpenPageFromButtonRule,
    "no-placeholder-ellipsis": noPlaceholderEllipsisRule,
    "no-product-name": noProductNameRule,
    "no-raw-async-primitives": noRawAsyncPrimitivesRule,
    "no-raw-heading-outside-ui": noRawHeadingOutsideUiRule,
    "no-raw-press-outside-ui": noRawPressOutsideUiRule,
    "no-reduced-motion-query": noReducedMotionQueryRule,
    "no-run-promise-outside-edges": noRunPromiseOutsideEdgesRule,
    "no-shadcn-focus-ring": noShadcnFocusRingRule,
    "no-source-read-in-test": noSourceReadInTestRule,
    retired: retiredRule,
    "skeleton-through-components": skeletonThroughComponentsRule,
  },
});

export default antiSlopPlugin;
