import { eslintCompatPlugin } from "@oxlint/plugins";

import { noEffectRuntimeOutsideEdgesRule } from "./rules/no-effect-runtime-outside-edges.ts";
import { noPromiseBridgeRule } from "./rules/no-promise-bridge.ts";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";

/** Opt-in Oxlint rules for Effect service and Layer architecture. */
const antiSlopEffectPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop-effect" },
  rules: {
    "no-effect-runtime-outside-edges": noEffectRuntimeOutsideEdgesRule,
    "no-promise-bridge": noPromiseBridgeRule,
    "no-service-constructor-imports": noServiceConstructorImportsRule,
  },
});

export default antiSlopEffectPlugin;
