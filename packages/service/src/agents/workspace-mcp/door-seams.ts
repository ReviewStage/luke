/**
 * door-seams.ts -- the seams the agent doors that reach an agent's sessions or the store's writer read, as the web function serving our MCP server builds them.
 *
 * The doors read their seams (`AgentDoorSeams`), built here once per
 * instance: the writer over the coding agent's tool set, and the summary
 * model an agent started from another replays with.
 */

import { storeWriter } from "@repo/database/models/writer";
import { Effect } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { AgentDoorSeams } from "../coder-host/agent-doors.js";
import { productionSummaryModel } from "../coder-host/replay-summary.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";

/** The doors' seams over the deployment's environment. */
export const workspaceMcpDoorSeams: Effect.Effect<AgentDoorSeams, never, HostedEnvironment> =
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const writer = yield* Effect.cached(storeWriter({ tools: CODER_TOOL_SET }));
    return {
      writer: () => writer,
      summaryModel: (owner, chosen, effort) =>
        productionSummaryModel(owner, chosen, effort).pipe(
          Effect.provideService(HostedEnvironment, environment),
        ),
    };
  });
