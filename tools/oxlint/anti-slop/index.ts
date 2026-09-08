import { eslintCompatPlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noReflectRule } from "./rules/no-reflect.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-known-value-widening": noKnownValueWideningRule,
    "no-reflect": noReflectRule,
    "no-runtime-typeof": noRuntimeTypeofRule,
    "no-unknown-parameters": noUnknownParametersRule,
    "no-unknown-returns": noUnknownReturnsRule,
    "no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
});

export default antiSlopPlugin;
