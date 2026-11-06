import { storeWriter } from "@repo/database/models/writer";
import { Effect } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { AgentDoorSeams } from "../coder-host/agent-doors.js";
import { productionSummaryModel } from "../coder-host/replay-summary.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";

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
