import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";
import { prepareSandbox } from "./host.js";

/**
 * sandbox.ts -- the one sandbox a session may open: the planning model's clone of its plan's repository.
 *
 * Only `run_in_repository` opens it (`server/hosted/repository-shell.ts`), so
 * a desk session never has one. It starts with no network at all, and eve
 * runs `onSession` once as it is made, which clones the plan's repository
 * into it.
 */

export default defineSandbox({
  backend: vercel({ networkPolicy: "deny-all" }),
  async onSession({ use, ctx }) {
    await prepareSandbox(ctx.session, await use());
  },
});
