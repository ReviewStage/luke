import { defineAgent } from "eve";
import { brainModel } from "../../agent.js";
import { host } from "../../host.js";

/**
 * The worker: a subagent the planning model hands slow or separate work to
 * through its \`delegate\` (\`../../tools/delegate.ts\`), run as a task so the
 * planning turn answers without waiting for it. Its findings reach the
 * planning model as a task result, never the developer directly. It is
 * declared hidden, so the model reaches it through that tool alone, as a
 * coding agent reaches its own. It authors no token budget, so it runs
 * under the root's, which is none (\`../../agent.ts\`).
 */
export default defineAgent({
  description:
    "Do one job in the background: research on the public Internet, reading the task's repository, or both. Returns at once; a short summary with its sources arrives later.",
  defaultTools: false,
  tool: false,
  model: brainModel(host.admitDelegated),
});
