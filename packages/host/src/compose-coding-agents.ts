import type { HostedCodingAgentClient } from "@luke/features";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentChangesAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxChanged,
  type CodingAgentInboxScope,
  type CodingAgentListAnswer,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPullRequestAnswerView,
  codingAgentArchiveParamsSchema,
  codingAgentChooseParamsSchema,
  codingAgentDefaultWriteParamsSchema,
  codingAgentGitHubImageParamsSchema,
  codingAgentInboxAnswerParamsSchema,
  codingAgentInboxAttachmentParamsSchema,
  codingAgentInboxScopeSchema,
  codingAgentListParamsSchema,
  codingAgentMessageParamsSchema,
  codingAgentMessagesParamsSchema,
  codingAgentPageParamsSchema,
  codingAgentPictureParamsSchema,
  codingAgentPinParamsSchema,
  codingAgentPullRequestParamsSchema,
  codingAgentRenameParamsSchema,
  codingAgentServersParamsSchema,
  codingAgentStartParamsSchema,
  codingAgentStopParamsSchema,
  codingAgentWorkspaceListParamsSchema,
  type DictationTranscribeAnswerView,
  dictationTranscribeParamsSchema,
  INBOX_SCOPE_KIND,
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
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, FiberHandle, FiberMap, RcMap, Result, type Schema, type Scope } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { followAccountInbox } from "./account-inbox-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { type LiveClient, openRealtimeClient } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";
import {
  followInbox,
  type InboxScopeKey,
  type ScopeInboxes,
  scopeInboxes,
} from "./scope-inbox-follow.js";

/**
 * compose-coding-agents.ts -- a plan's coding agents, asked of the service on the window's behalf: the models, the account's default, its own provider keys, and its plan template, the agents, one started, one's transcript, one messaged, one's model changed, one stopped, what one published, a clip dictated into an agent's box heard as words, the plan's inbox, one item of it answered, and what waits across the account.
 *
 * Nothing is held here but the followers of the account's inbox and of
 * each followed plan's or agent's. The window holds the agents it draws and the
 * cursor it reads from, asks when a plan opens, when it starts or stops an
 * agent, and while an agent's tab shows its running transcript, and every
 * ask is one call of the service answered whole. The transcript read is
 * one the service holds open while the agent runs and nothing new stands,
 * and a plan's or an agent's inbox is followed rather than asked: main
 * follows it while a window draws it, and it is heard as `INBOX_CHANGED`
 * events (`scope-inbox-follow.ts`). What waits across
 * the account is followed rather than asked: main follows it while an
 * account is signed in (`agent-notices.ts`), and it is heard as events,
 * over Neon Realtime where the service seals it (`account-inbox-follow.ts`),
 * whose sealed statements stay here beside the bearer. Behind a
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
  | "overview"
  | "githubImage"
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
  | "accountInboxLive"
  | "taskInboxLive"
  | "agentInboxLive"
  | "inboxAttachment"
  | "agentPicture"
>;

export interface CodingAgentsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: CodingAgentClient;
  /** Realtime's client at an address, which the account inbox is followed over; Realtime's own outside a test. */
  openLive?: (url: string) => LiveClient;
}

export interface CodingAgentsComposer extends Composer {
  /** The account inbox let go, and every plan's and agent's inbox subscription, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The key a scope's subscription and follow are held under. */
function scopeKeyOf(scope: CodingAgentInboxScope): InboxScopeKey {
  return scope.kind === INBOX_SCOPE_KIND.PLAN ? `plan:${scope.id}` : `agent:${scope.id}`;
}

/** Whether the service may be asked now: a run that sends, behind an open account gate. */
function gateOf({ kernel, account }: CodingAgentsDependencies): () => boolean {
  return () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
}

/** The service asked behind the gate, over the ambient fetch client. */
function askedOf(dependencies: CodingAgentsDependencies) {
  const gate = gateOf(dependencies);
  return <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provide(call, FetchHttpClient.layer) : Effect.succeed(UNANSWERED);
}

export function composeCodingAgents(
  dependencies: CodingAgentsDependencies,
): Effect.Effect<CodingAgentsComposer, never, Scope.Scope> {
  return Effect.gen(function* () {
    const follower = yield* FiberHandle.make<never>();
    const asked = askedOf(dependencies);
    const { client } = dependencies;
    const inboxes = yield* scopeInboxes({
      seal: (scope) => {
        const [kind, id] = scope.split(":", 2);
        return asked(
          kind === "plan" ? client.taskInboxLive(id ?? "") : client.agentInboxLive(id ?? ""),
        );
      },
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: dependencies.kernel.now,
    });
    const followed = yield* FiberMap.make<InboxScopeKey>();
    return composed(dependencies, follower, { inboxes, followed });
  });
}

/** The scopes' subscriptions the windows share, and the follows main asked for, one fiber per scope. */
interface ScopeFollows {
  readonly inboxes: ScopeInboxes;
  readonly followed: FiberMap.FiberMap<InboxScopeKey>;
}

/** The composer's one table, built from its seams; nothing here starts anything but the account inbox's follower, when main asks for it, and a scope's inbox subscription, while a window reads it. */
function composed(
  dependencies: CodingAgentsDependencies,
  follower: FiberHandle.FiberHandle<never>,
  { inboxes, followed }: ScopeFollows,
): CodingAgentsComposer {
  const { kernel, client } = dependencies;
  const gate = gateOf(dependencies);
  const asked = askedOf(dependencies);

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
    [GATEWAY_METHOD.CODING_AGENTS_OVERVIEW]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPullRequestParamsSchema,
          params,
          "reading an agent's pull request names one agent",
        );
        const answer = yield* asked(client.overview(agentId));
        return carried<CodingAgentOverviewAnswerView>(answer);
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
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* read(
          codingAgentInboxScopeSchema,
          params,
          "following an inbox names a plan or an agent",
        );
        const key = scopeKeyOf(scope);
        const tell = (inbox: CodingAgentInboxChanged["inbox"]) =>
          Effect.sync(() => kernel.emit(GATEWAY_EVENT.INBOX_CHANGED, carried({ scope, inbox })));
        const held = (after: string) =>
          asked(
            scope.kind === INBOX_SCOPE_KIND.PLAN
              ? client.inbox(scope.id, after)
              : client.agentInbox(scope.id, after),
          );
        const follow = gate() ? followInbox(inboxes, key, held, tell) : tell(UNANSWERED);
        yield* FiberMap.run(followed, key, follow);
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* read(
          codingAgentInboxScopeSchema,
          params,
          "letting an inbox go names a plan or an agent",
        );
        yield* FiberMap.remove(followed, scopeKeyOf(scope));
        return {};
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
    [GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW]: () =>
      Effect.map(
        FiberHandle.run(
          follower,
          followAccountInbox({
            live: () => asked(client.accountInboxLive()),
            held: (after) => asked(client.accountInbox(after)),
            openLive: dependencies.openLive ?? openRealtimeClient,
            now: kernel.now,
            publish: (answer) => kernel.emit(GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED, carried(answer)),
          }),
        ),
        () => ({}),
      ),
    [GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_UNFOLLOW]: () =>
      Effect.as(FiberHandle.clear(follower), {}),
  };

  const reset = Effect.gen(function* () {
    yield* FiberHandle.clear(follower);
    yield* FiberMap.clear(followed);
    for (const scope of yield* RcMap.keys(inboxes)) yield* RcMap.invalidate(inboxes, scope);
  });

  return { methods, lifetime: Effect.void, reset };
}
