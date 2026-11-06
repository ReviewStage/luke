import { type Agent, readAgent } from "@repo/database/models/agent-store";
import { queueDeviceAgentLine } from "@repo/database/models/device-agent-store";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@repo/features/device-agent-wire";
import { Effect, Option } from "effect";
import { holdingRunner } from "./coder-host/runner-lease.js";

const discardedWhileArchived = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<Agent, "id" | "userId">,
) {
  const read = yield* readAgent(agent.userId, agent.id);
  if (Option.isNone(read) || read.value.machine !== AGENT_MACHINE.DEVICE) return;
  yield* holdingRunner(
    agent.id,
    Effect.gen(function* () {
      const current = yield* readAgent(agent.userId, agent.id);
      if (Option.isNone(current) || current.value.archivedAt === null) return;
      yield* queueDeviceAgentLine(agent.userId, {
        agentId: agent.id,
        kind: DEVICE_AGENT_LINE_KIND.DISCARD,
        payload: {},
      });
    }),
  );
});

export const discardedOrLogged = (agent: Pick<Agent, "id" | "userId">) =>
  discardedWhileArchived(agent).pipe(
    Effect.as(true),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`an archived agent was not discarded from its device: ${failure._tag}`),
        false,
      ),
    ),
  );
