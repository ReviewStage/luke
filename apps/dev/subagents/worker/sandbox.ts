import { defineParentSandbox } from "eve/sandbox";

/**
 * The worker reads the agent's checkout in the agent's own sandbox
 * (`../../sandbox.ts`), uncommitted edits included, so what the agent and
 * every worker read is one tree, and a worker started before any read
 * checks the repository out once for the session rather than once for
 * itself.
 */
export default defineParentSandbox();
