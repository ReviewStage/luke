import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { taskBrowserTabsLiveStatement } from "@luke/database/models/agent-browser-tabs";
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { boardLiveStatement } from "@luke/database/models/board-store";
import { workspaceChatLiveStatements } from "@luke/database/models/chat-store";
import { macCommandsLiveStatement } from "@luke/database/models/mac-command-store";
import { repositoryPinsLiveStatement } from "@luke/database/models/repository-pin-store";
import { taskSectionsLiveStatements } from "@luke/database/models/task-section-store";
import { workspacesLiveStatements } from "@luke/database/models/workspace-store";
import { getTestDB, mutableFunctionsOf } from "@luke/database/testing";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import { MAC_COMMAND_KIND } from "@luke/features/mac-command-wire";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { workspaceInvitationsLiveStatement } from "../accounts/workspace-invitations.js";
import { workspaceMembersLiveStatements } from "../accounts/workspace-members.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import {
  accountInboxLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { taskPagesLiveStatements } from "../tasks/task-pages-live.js";
import { taskRecordLiveStatements } from "../tasks/task-record-live.js";
import { LiveSealing, liveSealingFromEnvironment, REALTIME_ENVIRONMENT } from "./realtime.js";

/**
 * Every statement the live endpoints seal calls only functions Postgres
 * marks immutable, since Neon Realtime refuses any other ("scalar expression
 * uses a mutable function") where Postgres runs it without a word.
 */

const USER_ID = "user-live-statements";

/** A deployment's Realtime over a synthetic secret in the shape its SDK reads, so no credential is written down. */
const SEALING_ENVIRONMENT = {
  DATABASE_URL: "postgresql://luke:synthetic@db.example/neondb?sslmode=require",
  [REALTIME_ENVIRONMENT.SWITCH]: "on",
  [REALTIME_ENVIRONMENT.URL]: "wss://realtime.example/v1",
  [REALTIME_ENVIRONMENT.SECRET]: `nrt_live_1${Buffer.alloc(32).toString("base64url")}`,
};

/** The reader a workspace's chat is sealed for: a person's member, as the store keeps one. */
const READER = {
  id: randomUUID(),
  organizationId: "workspace-live-statements",
  kind: MEMBER_KIND.HUMAN,
  userId: USER_ID,
  agentId: null,
  taskId: null,
  handle: "ada",
  ordinal: 1,
  readSeq: 0,
  noticeSeq: null,
  joinedAt: new Date(0),
  leftAt: null,
} as const;

/** Every live statement the endpoints seal, by the part it answers. */
function liveStatements() {
  const parent = randomUUID();
  const transcript = Option.getOrThrow(
    transcriptLiveStatements(
      { userId: USER_ID, conversationId: parent },
      parent,
      agentFollowedBy(USER_ID, parent, USER_ID),
    ),
  );
  const account = Option.getOrThrow(accountInboxLiveStatements(USER_ID));
  const chat = Option.getOrThrow(workspaceChatLiveStatements(USER_ID, READER));
  const task = Option.getOrThrow(taskInboxLiveStatements(USER_ID, randomUUID()));
  const agent = Option.getOrThrow(memberAgentInboxLiveStatements(USER_ID, randomUUID()));
  return {
    ...Object.fromEntries(
      Object.entries(account).map(([part, query]) => [`account.${part}`, query]),
    ),
    "account.failedRuns": Option.getOrThrow(ownFailedRunsLiveStatement(USER_ID)),
    "task.board": Option.getOrThrow(boardLiveStatement(USER_ID, randomUUID())),
    "task.pages": Option.getOrThrow(taskPagesLiveStatements(USER_ID, randomUUID())).pages,
    "task.browserTabs": Option.getOrThrow(taskBrowserTabsLiveStatement(USER_ID, randomUUID())),
    "task.history": Option.getOrThrow(taskHistoryLiveStatements(USER_ID, randomUUID())).revisions,
    "mac.commands": Option.getOrThrow(
      macCommandsLiveStatement(USER_ID, Object.values(MAC_COMMAND_KIND)),
    ),
    ...Object.fromEntries(
      Object.entries(Option.getOrThrow(taskRecordLiveStatements(USER_ID, randomUUID()))).map(
        ([part, query]) => [`task.${part}`, query],
      ),
    ),
    ...Object.fromEntries(
      Object.entries(transcript).map(([part, query]) => [`transcript.${part}`, query]),
    ),
    ...Object.fromEntries(Object.entries(chat).map(([part, query]) => [`chat.${part}`, query])),
    ...Object.fromEntries(Object.entries(task).map(([part, query]) => [`task.${part}`, query])),
    ...Object.fromEntries(Object.entries(agent).map(([part, query]) => [`agent.${part}`, query])),
    ...Object.fromEntries(
      Object.entries(Option.getOrThrow(workspacesLiveStatements(USER_ID))).map(([part, query]) => [
        `workspaces.${part}`,
        query,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(Option.getOrThrow(workspaceMembersLiveStatements(USER_ID, randomUUID()))).map(
        ([part, query]) => [`workspace-members.${part}`, query],
      ),
    ),
    "workspace-invitations.invitations": Option.getOrThrow(
      workspaceInvitationsLiveStatement(USER_ID, randomUUID()),
    ),
    ...Object.fromEntries(
      Object.entries(Option.getOrThrow(taskSectionsLiveStatements(USER_ID))).map(
        ([part, query]) => [`sidebar.${part}`, query],
      ),
    ),
    "sidebar.pins": Option.getOrThrow(repositoryPinsLiveStatement(USER_ID)),
  };
}

it.layer(getTestDB())("the live statements", (it) => {
  it.effect(
    "every statement a live endpoint seals calls only immutable functions, as Realtime requires",
    () =>
      Effect.gen(function* () {
        const mutable = yield* Effect.forEach(
          Object.entries(liveStatements()),
          ([part, statement]) =>
            Effect.map(mutableFunctionsOf(statement), (called) => [part, called] as const),
        );
        assert.deepEqual(
          mutable.filter(([, called]) => called.length > 0),
          [],
        );
      }),
  );

  it.effect(
    "every statement a live endpoint seals is a Drizzle select Realtime's Drizzle adapter seals, each key the name Postgres answers it under",
    () =>
      Effect.gen(function* () {
        const sealing = yield* Effect.gen(function* () {
          return yield* LiveSealing;
        }).pipe(
          Effect.provide(
            liveSealingFromEnvironment.pipe(
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(SEALING_ENVIRONMENT))),
            ),
          ),
        );
        assert.ok(Option.isSome(sealing));
        const { seal } = sealing.value;
        const refused = yield* Effect.forEach(
          Object.entries(liveStatements()),
          ([part, statement]): Effect.Effect<string | undefined> =>
            statement.query === undefined
              ? Effect.succeed(`${part}: no Drizzle select`)
              : Effect.match(seal(statement), {
                  onFailure: () => `${part}: refused`,
                  onSuccess: () => undefined,
                }),
        );
        assert.deepEqual(
          refused.filter((entry) => entry !== undefined),
          [],
        );
      }),
  );
});
