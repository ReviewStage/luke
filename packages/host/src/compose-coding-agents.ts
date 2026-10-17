import type { HostedCodingAgentClient } from "@luke/features";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
  type CodingAgentAgentAnswer,
  type CodingAgentChangesAnswerView,
  type CodingAgentChatAnswerView,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentListAnswer,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
  codingAgentAccountInboxParamsSchema,
  codingAgentAgentInboxParamsSchema,
  codingAgentArchiveParamsSchema,
  codingAgentChatParamsSchema,
  codingAgentChatPostParamsSchema,
  codingAgentChooseParamsSchema,
  codingAgentDefaultWriteParamsSchema,
  codingAgentGitHubImageParamsSchema,
  codingAgentInboxAnswerParamsSchema,
  codingAgentInboxAttachmentParamsSchema,
  codingAgentInboxParamsSchema,
  codingAgentListParamsSchema,
  codingAgentMessageParamsSchema,
  codingAgentMessagesParamsSchema,
  codingAgentPageParamsSchema,
  codingAgentPictureParamsSchema,
  codingAgentPinParamsSchema,
  codingAgentPullRequestActionParamsSchema,
  codingAgentPullRequestParamsSchema,
  codingAgentRenameParamsSchema,
  codingAgentServersParamsSchema,
  codingAgentStartParamsSchema,
  codingAgentStopParamsSchema,
  codingAgentWorkspaceListParamsSchema,
  type DictationTranscribeAnswerView,
  dictationTranscribeParamsSchema,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionsAnswerView,
  type ProviderKeysAnswerView,
  planTemplateRevisionParamsSchema,
  planTemplateRevisionsParamsSchema,
  planTemplateWriteParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
} from "@luke/features/coding-agent-view";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, invalid } from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Schema, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-coding-agents.ts -- a task's coding agents, asked of the service on the window's behalf: the models, the account's default, its own provider keys, and its plan template, the agents, one started, one's transcript, one messaged, one's model changed, one stopped, what one published, a clip dictated into an agent's box heard as words, the task's inbox, one item of it answered, what waits across the account, and the workspace's chat, read and written.
 *
 * Nothing is held here. The window holds the agents it draws and the
 * cursor it reads from, asks when a task opens, when it starts or stops an
 * agent, and while an agent's tab shows its running transcript, and every
 * ask is one call of the service answered whole. The transcript read is
 * one the service holds open while the agent runs and nothing new stands,
 * and the inbox read another, held while nothing in it changed, and the
 * chat read a third, held while nothing in the workspace's chat moved, so each of
 * the window's loops is one held read after another rather than a clock of
 * its own, and a loop ends when the window stops asking. What waits across
 * the account is held the same way, and asked by main's own loop rather
 * than a window's (`agent-notices.ts`). Behind a
 * closed account gate, or on a run that sends nothing, every ask answers
 * unanswered. A provider key passes through on its way to the service and
 * is held nowhere here; no answer carries one back.
 */

/** The service's side of the agents, as this concern asks it. */
export type CodingAgentClient = Pick<
  HostedCodingAgentClient,
  | "models"
  | "readDefault"
  | "writeDefault"
  | "list"
  | "listWorkspace"
  | "start"
  | "messages"
  | "message"
  | "choose"
  | "rename"
  | "switchServers"
  | "archive"
  | "pin"
  | "stop"
  | "agent"
  | "agentInbox"
  | "pullRequest"
  | "changes"
  | "overviewPullRequest"
  | "overviewChecks"
  | "overviewConversation"
  | "githubImage"
  | "pullRequestAction"
  | "readProviderKeys"
  | "saveProviderKey"
  | "removeProviderKey"
  | "readPlanTemplate"
  | "writePlanTemplate"
  | "readPlanTemplateRevisions"
  | "readPlanTemplateRevision"
  | "restorePlanTemplate"
  | "transcribeDictation"
  | "inbox"
  | "answerInbox"
  | "accountInbox"
  | "inboxAttachment"
  | "agentPicture"
  | "chat"
  | "chatPost"
>;

export interface CodingAgentsDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: CodingAgentClient;
}

export type CodingAgentsComposer = Composer;

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

export function composeCodingAgents(
  dependencies: CodingAgentsDependencies,
): Effect.Effect<CodingAgentsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    return composed(dependencies, yield* HttpClient.HttpClient);
  });
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(
  dependencies: CodingAgentsDependencies,
  http: HttpClient.HttpClient,
): CodingAgentsComposer {
  const { kernel, account, client } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the host's own HTTP client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

  /** The params read against the method's own schema, or the invalid-params refusal worded. */
  const read = <Params>(
    schema: Schema.Codec<Params, unknown>,
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
    sentence: string,
  ) => {
    const result = readEither(schema)(unparsedWire(params));
    return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
  };

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.CODING_AGENTS_MODELS]: () =>
      Effect.map(asked(client.models()), (answer) => carried<CodingAgentModelsAnswer>(answer)),
    [GATEWAY_METHOD.CODING_AGENTS_DEFAULT_READ]: () =>
      Effect.map(asked(client.readDefault()), (answer) =>
        carried<CodingAgentDefaultAnswer>(answer),
      ),
    [GATEWAY_METHOD.CODING_AGENTS_DEFAULT_WRITE]: (params) =>
      Effect.gen(function* () {
        const choice = yield* read(
          codingAgentDefaultWriteParamsSchema,
          params,
          "the default names a model and its effort",
        );
        const answer = yield* asked(client.writeDefault(choice));
        return carried<CodingAgentDefaultAnswer>(answer);
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_READ]: () =>
      Effect.map(asked(client.readProviderKeys()), (answer) =>
        carried<ProviderKeysAnswerView>(answer),
      ),
    [GATEWAY_METHOD.PROVIDER_KEYS_SAVE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the value, because the value is a key.
        const save = yield* read(
          providerKeySaveParamsSchema,
          params,
          "a save names a provider and a key",
        );
        const answer = yield* asked(client.saveProviderKey(save));
        return carried<ProviderKeysAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_READ]: () =>
      Effect.map(asked(client.readPlanTemplate()), (answer) =>
        carried<PlanTemplateAnswerView>(answer),
      ),
    [GATEWAY_METHOD.PLAN_TEMPLATE_WRITE]: (params) =>
      Effect.gen(function* () {
        const write = yield* read(
          planTemplateWriteParamsSchema,
          params,
          "a template write names a template within the bound, or null for the default",
        );
        const answer = yield* asked(client.writePlanTemplate(write));
        return carried<PlanTemplateAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const page = yield* read(
          planTemplateRevisionsParamsSchema,
          params,
          "a page of the template's history names the revision it is read before, or none",
        );
        const answer = yield* asked(client.readPlanTemplateRevisions(page));
        return carried<PlanTemplateRevisionsAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_REVISION]: (params) =>
      Effect.gen(function* () {
        const revision = yield* read(
          planTemplateRevisionParamsSchema,
          params,
          "a revision of the template names its number",
        );
        const answer = yield* asked(client.readPlanTemplateRevision(revision));
        return carried<PlanTemplateRevisionAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_RESTORE]: (params) =>
      Effect.gen(function* () {
        const revision = yield* read(
          planTemplateRevisionParamsSchema,
          params,
          "a restore of the template names the revision it brings back",
        );
        const answer = yield* asked(client.restorePlanTemplate(revision));
        return carried<PlanTemplateAnswerView>(answer);
      }),
    [GATEWAY_METHOD.DICTATION_TRANSCRIBE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the words, because they are the developer's voice.
        const clip = yield* read(
          dictationTranscribeParamsSchema,
          params,
          "a clip names its audio, its length, and its words",
        );
        const answer = yield* asked(client.transcribeDictation(clip));
        return carried<DictationTranscribeAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_REMOVE]: (params) =>
      Effect.gen(function* () {
        const removal = yield* read(
          providerKeyRemoveParamsSchema,
          params,
          "a removal names a provider",
        );
        const answer = yield* asked(client.removeProviderKey(removal));
        return carried<ProviderKeysAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_LIST]: (params) =>
      Effect.gen(function* () {
        const { taskId, includeArchived } = yield* read(
          codingAgentListParamsSchema,
          params,
          "listing a plan's agents names one plan",
        );
        const answer = yield* asked(client.list(taskId, includeArchived));
        return carried<CodingAgentListAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_WORKSPACE_LIST]: (params) =>
      Effect.gen(function* () {
        const listed = yield* read(
          codingAgentWorkspaceListParamsSchema,
          params,
          "listing a workspace's agents names one workspace",
        );
        return carried<CodingAgentListAnswer>(yield* asked(client.listWorkspace(listed)));
      }),
    [GATEWAY_METHOD.CODING_AGENTS_START]: (params) =>
      Effect.gen(function* () {
        const { taskId, ...request } = yield* read(
          codingAgentStartParamsSchema,
          params,
          "starting an agent names a plan and the press's own key",
        );
        const answer = yield* asked(client.start(taskId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_MESSAGES]: (params) =>
      Effect.gen(function* () {
        const { agentId, after, callId } = yield* read(
          codingAgentMessagesParamsSchema,
          params,
          "reading an agent's transcript names the agent and a cursor",
        );
        const answer = yield* asked(client.messages(agentId, after, callId));
        return carried<CodingAgentMessagesAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_MESSAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentMessageParamsSchema,
          params,
          "messaging an agent names the agent, its words, and the send's key",
        );
        const answer = yield* asked(client.message(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHOOSE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...choice } = yield* read(
          codingAgentChooseParamsSchema,
          params,
          "changing an agent's model names the agent, a model, and its effort",
        );
        const answer = yield* asked(client.choose(agentId, choice));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_RENAME]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentRenameParamsSchema,
          params,
          "renaming an agent names the agent and its title",
        );
        const answer = yield* asked(client.rename(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_SERVERS]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentServersParamsSchema,
          params,
          "switching an agent's MCP servers names the agent and the servers off",
        );
        const answer = yield* asked(client.switchServers(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentArchiveParamsSchema,
          params,
          "archiving an agent names the agent and whether it is archived",
        );
        const answer = yield* asked(client.archive(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PIN]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentPinParamsSchema,
          params,
          "pinning an agent names the agent and whether it is pinned",
        );
        const answer = yield* asked(client.pin(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_STOP]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentStopParamsSchema,
          params,
          "stopping an agent names one agent",
        );
        const answer = yield* asked(client.stop(agentId));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPageParamsSchema,
          params,
          "reading an agent's page names one agent",
        );
        const answer = yield* asked(client.agent(agentId));
        return carried<CodingAgentPageAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPullRequestParamsSchema,
          params,
          "reading what an agent published names one agent",
        );
        const answer = yield* asked(client.pullRequest(agentId));
        return carried<CodingAgentPullRequestAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHANGES]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPullRequestParamsSchema,
          params,
          "reading an agent's changes names one agent",
        );
        const answer = yield* asked(client.changes(agentId));
        return carried<CodingAgentChangesAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPullRequestParamsSchema,
          params,
          "reading an agent's pull request names one agent",
        );
        const answer = yield* asked(client.overviewPullRequest(agentId));
        return carried<CodingAgentOverviewPullRequestAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CHECKS]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPullRequestParamsSchema,
          params,
          "reading an agent's pull request's checks names one agent",
        );
        const answer = yield* asked(client.overviewChecks(agentId));
        return carried<CodingAgentOverviewChecksAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CONVERSATION]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPullRequestParamsSchema,
          params,
          "reading an agent's pull request's conversation names one agent",
        );
        const answer = yield* asked(client.overviewConversation(agentId));
        return carried<CodingAgentOverviewConversationAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST_ACTION]: (params) =>
      Effect.gen(function* () {
        const { agentId, request } = yield* read(
          codingAgentPullRequestActionParamsSchema,
          params,
          "changing an agent's pull request names the agent and the change",
        );
        const answer = yield* asked(client.pullRequestAction(agentId, request));
        return carried<CodingAgentPullRequestWriteAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_GITHUB_IMAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId, src } = yield* read(
          codingAgentGitHubImageParamsSchema,
          params,
          "reading an image of an agent's pull request names the agent and the image's address",
        );
        const answer = yield* asked(client.githubImage(agentId, src));
        return carried<CodingAgentGitHubImageView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX]: (params) =>
      Effect.gen(function* () {
        const { taskId, after } = yield* read(
          codingAgentInboxParamsSchema,
          params,
          "reading a plan's inbox names the plan and a cursor",
        );
        const answer = yield* asked(client.inbox(taskId, after));
        return carried<CodingAgentInboxAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_AGENT_INBOX]: (params) =>
      Effect.gen(function* () {
        const { agentId, after } = yield* read(
          codingAgentAgentInboxParamsSchema,
          params,
          "reading an agent's inbox names the agent and a cursor",
        );
        const answer = yield* asked(client.agentInbox(agentId, after));
        return carried<CodingAgentInboxAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_ATTACHMENT]: (params) =>
      Effect.gen(function* () {
        const { itemId, attachmentId } = yield* read(
          codingAgentInboxAttachmentParamsSchema,
          params,
          "reading an inbox item's image names the item and the attachment",
        );
        const answer = yield* asked(client.inboxAttachment(itemId, attachmentId));
        return carried<CodingAgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const { agentId, pictureId, callId } = yield* read(
          codingAgentPictureParamsSchema,
          params,
          "reading an agent's picture names the agent and the picture",
        );
        const answer = yield* asked(client.agentPicture(agentId, pictureId, callId));
        return carried<CodingAgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER]: (params) =>
      Effect.gen(function* () {
        const { itemId, ...request } = yield* read(
          codingAgentInboxAnswerParamsSchema,
          params,
          "answering an inbox item names the item, the revision it answers, the answer, and the answer's key",
        );
        const answer = yield* asked(client.answerInbox(itemId, request));
        return carried<CodingAgentInboxAnsweredView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAT]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, after } = yield* read(
          codingAgentChatParamsSchema,
          params,
          "reading a workspace's chat names the workspace and a cursor",
        );
        const answer = yield* asked(client.chat(workspaceId, after));
        return carried<CodingAgentChatAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAT_POST]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, write } = yield* read(
          codingAgentChatPostParamsSchema,
          params,
          "writing to a workspace's chat names the workspace and one post, answer, resolve, or read",
        );
        const answer = yield* asked(client.chatPost(workspaceId, write));
        return carried<CodingAgentChatWriteAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX]: (params) =>
      Effect.gen(function* () {
        const { after } = yield* read(
          codingAgentAccountInboxParamsSchema,
          params,
          "reading what waits across the account names a cursor",
        );
        const answer = yield* asked(client.accountInbox(after));
        return carried<CodingAgentAccountInboxAnswerView>(answer);
      }),
  };

  return { methods, lifetime: Effect.void };
}
