import {
  type Agent,
  type AgentArchiveCommitted,
  type AgentCommitted,
  archiveAgentCommitted,
  pinAgentCommitted,
  renameAgentCommitted,
  updateAgentChoiceCommitted,
  updateAgentServersCommitted,
} from "@repo/database/models/agent-store";
import type { StoreWriter } from "@repo/database/models/writer";
import type { StoredArchive } from "@repo/database/schemas/agent";
import type { ModelChoice } from "@repo/features/models-wire";
import { Data, Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { recordServerEvent, SERVER_AGENT_SETTING, SERVER_EVENT } from "../events/server-events.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";
import { runnerChoiceApplied } from "./coder-host/runtime-sessions.js";
import { stoppedForGood } from "./coder-host/stop.js";
import { type SandboxStopReach, stoppedInBackground } from "./session-sandboxes.js";

export interface AgentChanges {
  readonly title?: string | undefined;
  readonly choice?: ModelChoice | undefined;
  readonly pinned?: boolean | undefined;
  readonly position?: string | undefined;
  readonly disabledServers?: readonly string[] | undefined;
}

class AgentChangeLost extends Data.TaggedError("AgentChangeLost") {}

function settingsMoved(agent: Agent, choice: ModelChoice) {
  return [
    ...(choice.model === agent.model ? [] : [SERVER_AGENT_SETTING.MODEL]),
    ...(choice.effort === agent.effort ? [] : [SERVER_AGENT_SETTING.EFFORT]),
  ];
}

const writtenChanges = (userId: string, agent: Agent, changes: AgentChanges) =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const kept = (changed: Option.Option<AgentCommitted>) =>
          Option.isSome(changed)
            ? Effect.succeed(changed.value)
            : Effect.fail(new AgentChangeLost());
        const { title, choice, pinned, position, disabledServers } = changes;
        let last: AgentCommitted = { agent };
        if (title !== undefined) {
          last = yield* kept(
            yield* renameAgentCommitted(userId, agent.id, title.length === 0 ? null : title),
          );
        }
        if (choice !== undefined) {
          last = yield* kept(yield* updateAgentChoiceCommitted(userId, agent.id, choice));
        }
        if (pinned !== undefined) {
          last = yield* kept(yield* pinAgentCommitted(userId, agent.id, pinned, position));
        }
        if (disabledServers !== undefined) {
          last = yield* kept(yield* updateAgentServersCommitted(userId, agent.id, disabledServers));
        }
        return last;
      }),
    ),
  );

export const changedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
  changes: AgentChanges,
) {
  const written = yield* writtenChanges(userId, agent, changes).pipe(
    Effect.map(Option.some),
    Effect.catchTag("AgentChangeLost", () => Effect.succeed(Option.none<AgentCommitted>())),
  );
  const { choice } = changes;
  if (choice === undefined || Option.isNone(written)) return written;
  yield* runnerChoiceApplied(written.value.agent);
  for (const changed of settingsMoved(agent, choice)) {
    yield* recordServerEvent(
      SERVER_EVENT.AGENT_SETTINGS_CHANGE,
      { userId, workspaceId: agent.organizationId },
      { changed },
    );
  }
  return written;
});

export const archivedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxStopReach,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  archived: boolean,
  archivedBy: StoredArchive,
) {
  if (archived) yield* stoppedForGood(writer, userId, agent);
  const written: Option.Option<AgentArchiveCommitted> = yield* hostedStoreOrUnavailable(
    archiveAgentCommitted(userId, agent.id, archived, archivedBy),
  );
  if (!archived || Option.isNone(written)) return written;
  yield* stoppedInBackground(reach, [agent]);
  if (written.value.archivedNow) {
    yield* recordServerEvent(
      SERVER_EVENT.AGENT_ARCHIVE,
      { userId, workspaceId: agent.organizationId },
      { agent_kind: agent.kind },
    );
  }
  return written;
});
