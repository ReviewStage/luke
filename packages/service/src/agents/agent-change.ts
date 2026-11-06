/**
 * agent-change.ts -- an agent changed or archived, as the one operation the app's menu, `update_agent`, and the command line all run.
 *
 * The app's `agents.change` names one change a call and `update_agent` may
 * name several, so a change is a partial (`AgentChanges`) written in one
 * transaction, either every change standing or none. A model and effort
 * moved are handed to a native runner that runs at once and counted for each
 * of the two that moved. An archive stops a turn still running first, as a
 * Stop does, then stamps the agent, lets its sandbox and its device go once
 * the archive stands, and is counted where it archived an agent standing
 * unarchived; bringing one back clears whichever archive stands.
 */

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

/** The changes asked of an agent, each already read, and a choice already the catalog's; any left out stands. */
export interface AgentChanges {
  /** Its title, cleared where empty, so its tab falls back to the model's name. */
  readonly title?: string | undefined;
  readonly choice?: ModelChoice | undefined;
  /** Whether the asking member keeps it pinned, and where among their pins. */
  readonly pinned?: boolean | undefined;
  readonly position?: string | undefined;
  readonly disabledServers?: readonly string[] | undefined;
}

/** A change that found no row to write: the agent left the account's reach as it was changed, which takes every change back. */
class AgentChangeLost extends Data.TaggedError("AgentChangeLost") {}

/** The settings a choice moved, each counted once. */
function settingsMoved(agent: Agent, choice: ModelChoice) {
  return [
    ...(choice.model === agent.model ? [] : [SERVER_AGENT_SETTING.MODEL]),
    ...(choice.effort === agent.effort ? [] : [SERVER_AGENT_SETTING.EFFORT]),
  ];
}

/** Every change asked written in one transaction: the agent as the last write left it, the agent as it stood where none was asked. */
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

/**
 * The agent changed for what follows, every change asked or none, answered
 * as it then stands with the transaction it was written in; nothing where
 * the agent left the account's reach. A choice moved is handed to a native
 * runner that runs now, and eve reads the row at its next step.
 */
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
  // Counted for each of the two the change moved, under the member; a window alone counts none.
  for (const changed of settingsMoved(agent, choice)) {
    yield* recordServerEvent(
      SERVER_EVENT.AGENT_SETTINGS_CHANGE,
      { userId, workspaceId: agent.organizationId },
      { changed },
    );
  }
  return written;
});

/**
 * The agent archived by who the stamp names, or brought back. An archived
 * agent works on unseen, so a turn still running is stopped before the
 * stamp, refused where none can be stopped yet (`stoppedForGood`); once the
 * archive stands its sandbox is stopped, not deleted, so an unarchive resumes
 * it from its snapshot, and a local agent is let go of on its device.
 * Nothing where the agent left the account's reach.
 */
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
  // Counted only where this write archived an agent standing unarchived, under the member it archived for.
  if (written.value.archivedNow) {
    yield* recordServerEvent(
      SERVER_EVENT.AGENT_ARCHIVE,
      { userId, workspaceId: agent.organizationId },
      { agent_kind: agent.kind },
    );
  }
  return written;
});
