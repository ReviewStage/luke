import { defineParentSandbox } from "eve/sandbox";

/**
 * The worker reads the task's repository in the brain's session's own
 * sandbox (`../../sandbox.ts`), so a checkout either of them made is what
 * both read, and a worker started before any read checks the repository out
 * once for the session rather than once for itself.
 */
export default defineParentSandbox();
