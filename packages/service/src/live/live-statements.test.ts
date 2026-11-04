import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { browserTabsLiveStatement } from "@repo/database/models/agent-browser-tabs";
import { ownFailedRunsLiveStatement } from "@repo/database/models/automation-store";
import { installedSkillsLiveStatement } from "@repo/database/models/installed-skill-store";
import { sentryInstallationsLiveStatement } from "@repo/database/models/integration-installation-store";
import { macCommandsLiveStatement } from "@repo/database/models/mac-command-store";
import { workspaceMemoriesLiveStatement } from "@repo/database/models/memory-store";
import { pullRequestChaptersLiveStatement } from "@repo/database/models/pull-request-chapters-store";
import { repositoryPinsLiveStatement } from "@repo/database/models/repository-pin-store";
import {
  slackChannelRepositoriesLiveStatement,
  slackInstallationLiveStatement,
} from "@repo/database/models/slack-installation-store";
import { taskSectionsLiveStatements } from "@repo/database/models/task-section-store";
import { workspacesLiveStatements } from "@repo/database/models/workspace-store";
import { getTestDB, mutableFunctionsOf } from "@repo/database/testing";
import { MAC_COMMAND_KIND } from "@repo/features/mac-command-wire";
import { Effect, Option } from "effect";
import { workspaceInvitationsLiveStatement } from "../accounts/workspace-invitations.js";
import { workspaceMembersLiveStatements } from "../accounts/workspace-members.js";
import { agentOriginLiveStatements } from "../agents/agent-origin-live.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import {
  accountInboxLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { integrationStatusesLiveStatement } from "../integrations/integration-store.js";
import { taskCommentsLiveStatements } from "../tasks/plan-comments-live.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { agentPagesLiveStatements, taskPagesLiveStatements } from "../tasks/task-pages-live.js";
import { taskRecordLiveStatements } from "../tasks/task-record-live.js";

/**
 * Every statement the live endpoints answer calls only functions Postgres
 * marks immutable, so the same rows always read alike: a statement that read
 * the clock or the session would digest anew on every look, and a held read
 * would answer at once rather than hold.
 */

const USER_ID = "user-live-statements";

/** Every live statement the endpoints answer, by the part it answers. */
function liveStatements() {
  const parent = randomUUID();
  const transcript = Option.getOrThrow(
    transcriptLiveStatements(
      { userId: USER_ID, conversationId: parent },
      parent,
      agentFollowedBy(USER_ID, parent, USER_ID),
    ),
  );
  const account = Option.getOrThrow(accountInboxLiveStatements(USER_ID, true));
  const task = Option.getOrThrow(taskInboxLiveStatements(USER_ID, randomUUID()));
  const agent = Option.getOrThrow(memberAgentInboxLiveStatements(USER_ID, randomUUID()));
  return {
    ...Object.fromEntries(
      Object.entries(account).map(([part, query]) => [`account.${part}`, query]),
    ),
    "account.failedRuns": Option.getOrThrow(ownFailedRunsLiveStatement(USER_ID)),
    "task.pages": Option.getOrThrow(taskPagesLiveStatements(USER_ID, randomUUID())).pages,
    "agent.pages": Option.getOrThrow(agentPagesLiveStatements(USER_ID, randomUUID())).pages,
    "agent.origin": Option.getOrThrow(agentOriginLiveStatements(USER_ID, randomUUID())).origin,
    "task.browserTabs": Option.getOrThrow(
      browserTabsLiveStatement(USER_ID, { taskId: randomUUID() }),
    ),
    "agent.browserTabs": Option.getOrThrow(
      browserTabsLiveStatement(USER_ID, { agentId: randomUUID() }),
    ),
    "task.history": Option.getOrThrow(taskHistoryLiveStatements(USER_ID, randomUUID())).revisions,
    ...Object.fromEntries(
      Object.entries(
        Option.getOrThrow(
          taskCommentsLiveStatements(USER_ID, { taskId: randomUUID(), pageId: randomUUID() }),
        ),
      ).map(([part, query]) => [`task.comments.${part}`, query]),
    ),
    "agent.pullRequestChapters": Option.getOrThrow(
      pullRequestChaptersLiveStatement(USER_ID, randomUUID(), 7),
    ),
    "account.integrations": Option.getOrThrow(
      integrationStatusesLiveStatement(USER_ID, new Date(0)),
    ),
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
    "workspace-memories.memories": Option.getOrThrow(
      workspaceMemoriesLiveStatement(USER_ID, randomUUID()),
    ),
    "installed-skills.skills": Option.getOrThrow(
      installedSkillsLiveStatement(USER_ID, randomUUID()),
    ),
    "workspace-integrations.sentryInstallations": Option.getOrThrow(
      sentryInstallationsLiveStatement(USER_ID, randomUUID()),
    ),
    "workspace-integrations.slackInstallation": Option.getOrThrow(
      slackInstallationLiveStatement(USER_ID, randomUUID()),
    ),
    "workspace-integrations.slackChannelRepositories": Option.getOrThrow(
      slackChannelRepositoriesLiveStatement(USER_ID, randomUUID()),
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
    "every statement a live endpoint answers calls only immutable functions, so its rows digest alike on every look",
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
});
