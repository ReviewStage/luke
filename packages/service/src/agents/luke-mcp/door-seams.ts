/**
 * door-seams.ts -- the seams the agent doors that reach eve or the store's writer read, as the web function serving Luke's MCP server builds them.
 *
 * eve's coding agent reads these from the coder host's own seams
 * (`../coder-host/production.ts`), which compose eve's runtime; the MCP
 * server's function bundles none of it, so the four the doors read
 * (`AgentDoorSeams`) are built here from the same reads: the writer over
 * the coding agent's tool set, the deployment's secret and origin for eve,
 * and the summary model an agent started from another replays with.
 */

import { storeWriter } from "@luke/database/models/writer";
import { Effect } from "effect";
import { HostedEnvironment } from "../../environment.js";
import { deploymentEveOrigin } from "../brain-host/eve-origin.js";
import type { AgentDoorSeams } from "../coder-host/agent-doors.js";
import { productionSummaryModel } from "../coder-host/replay-summary.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";

/** The doors' seams over the deployment's environment. */
export const lukeMcpDoorSeams: Effect.Effect<AgentDoorSeams, never, HostedEnvironment> = Effect.gen(
  function* () {
    const environment = yield* HostedEnvironment;
    const writer = yield* Effect.cached(storeWriter({ tools: CODER_TOOL_SET }));
    return {
      writer: () => writer,
      deploymentSecret: () => environment.eveDeploymentSecret,
      eveOrigin: deploymentEveOrigin,
      summaryModel: (owner, chosen, effort) =>
        productionSummaryModel(owner, chosen, effort).pipe(
          Effect.provideService(HostedEnvironment, environment),
        ),
    };
  },
);
