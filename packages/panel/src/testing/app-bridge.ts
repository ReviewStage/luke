import { ORPCError } from "@orpc/client";
import type { AgentChangesAnswerView } from "@repo/features/agent-view";
import type { TaskFileRequest } from "@repo/features/task-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import type { AppBridge } from "@repo/host/bridge";
import {
  ACCOUNT_ASK_ACT_KIND,
  ACT_ERROR,
  type ActPortClient,
  AGENT_ACT_KIND,
  AGENT_INBOX_ACT_KIND,
  AUTOMATION_ACT_KIND,
  actContract,
  CHAPTERS_ACT_KIND,
  INSTALLED_SKILL_ACT_KIND,
  INTEGRATION_ACT_KIND,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "@repo/host/contract";
import type { WireBoundaryInput } from "@repo/wire";
import { installActPortClient, installAppBridge } from "../app-bridge.js";

let answering: Partial<AppBridge> = {};
let answeringPort: Partial<FakeActPort> = {};

export function fakeAppBridge(calls: Partial<AppBridge>): void {
  answering = calls;
  installAppBridge(calls as AppBridge);
}

export function fakeAppBridgeCalls(): Partial<AppBridge> {
  return answering;
}

type HoldKind =
  | typeof AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW
  | typeof AGENT_ACT_KIND.AGENTS_TRANSCRIPT
  | typeof AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW
  | typeof INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW
  | typeof TASKS_ACT_KIND.TASKS_PAGES_FOLLOW
  | typeof TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW
  | typeof CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW
  | typeof AGENT_ACT_KIND.HOSTS_PRESENCE_FOLLOW
  | typeof AGENT_ACT_KIND.HOSTS_FOLLOW
  | typeof AGENT_ACT_KIND.AGENTS_MODELS_FOLLOW
  | typeof AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW
  | typeof AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW
  | typeof INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW
  | typeof INTEGRATION_ACT_KIND.MCP_CLIENTS_FOLLOW
  | typeof ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW
  | typeof TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW
  | typeof TASKS_ACT_KIND.TASKS_LINK_STANDING_FOLLOW
  | typeof ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW
  | typeof ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW
  | typeof INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_FOLLOW
  | typeof AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW
  | typeof TASKS_ACT_KIND.TASKS_COMMENTS_FOLLOW
  | typeof TASKS_ACT_KIND.TASKS_HISTORY_FOLLOW
  | typeof WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_FOLLOW
  | typeof WORKSPACE_ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW
  | typeof WORKSPACE_ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW
  | typeof WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW
  | typeof WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW
  | typeof TASKS_ACT_KIND.TASKS_DOCUMENT_FOLLOW;

const QUIET_HOLDS: ReadonlySet<PortActKind> = new Set<HoldKind>([
  AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW,
  AGENT_ACT_KIND.AGENTS_TRANSCRIPT,
  AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW,
  INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW,
  TASKS_ACT_KIND.TASKS_PAGES_FOLLOW,
  TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW,
  CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW,
  AGENT_ACT_KIND.HOSTS_PRESENCE_FOLLOW,
  AGENT_ACT_KIND.HOSTS_FOLLOW,
  AGENT_ACT_KIND.AGENTS_MODELS_FOLLOW,
  AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW,
  AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW,
  INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW,
  INTEGRATION_ACT_KIND.MCP_CLIENTS_FOLLOW,
  ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_FOLLOW,
  TASKS_ACT_KIND.TASKS_REPOSITORIES_FOLLOW,
  TASKS_ACT_KIND.TASKS_LINK_STANDING_FOLLOW,
  ACCOUNT_ASK_ACT_KIND.GITHUB_TOKEN_FOLLOW,
  ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW,
  INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_FOLLOW,
  AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW,
  TASKS_ACT_KIND.TASKS_COMMENTS_FOLLOW,
  TASKS_ACT_KIND.TASKS_HISTORY_FOLLOW,
  WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_FOLLOW,
  WORKSPACE_ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW,
  WORKSPACE_ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW,
  WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW,
  WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW,
  TASKS_ACT_KIND.TASKS_DOCUMENT_FOLLOW,
]);

export function quietHold<Kind extends HoldKind>(): Promise<PortActResult<Kind>> {
  return heldUntilClosed<Kind>(() => undefined);
}

export function heldUntilClosed<Kind extends HoldKind>(
  closed: () => void,
): Promise<PortActResult<Kind>> {
  const ended = Promise.withResolvers<IteratorReturnResult<undefined>>();
  const close = () => {
    closed();
    ended.resolve({ done: true, value: undefined });
  };
  const stream: AsyncIteratorObject<never, undefined, unknown> = {
    next: () => ended.promise,
    return: async () => {
      close();
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]: () => stream,
    [Symbol.asyncDispose]: async () => {
      close();
    },
  };
  return Promise.resolve(stream as unknown as PortActResult<Kind>);
}

export function fakeActPort(procedures: Partial<FakeActPort>): void {
  const answered: Partial<FakeActPort> = {
    ...Object.fromEntries([...QUIET_HOLDS].map((kind) => [kind, quietHold])),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY]: () => Promise.resolve(),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_RETRY]: () => Promise.resolve(),
    [TASKS_ACT_KIND.TASKS_REPOSITORIES_RETRY]: () => Promise.resolve(),
    [ACCOUNT_ASK_ACT_KIND.MEMORIES_RETRY]: () => Promise.resolve(),
    [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_RETRY]: () => Promise.resolve(),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY]: () => Promise.resolve(),
    [WORKSPACE_ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY]: () => Promise.resolve(),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_CHANNELS_RETRY]: () => Promise.resolve(),
    [AGENT_ACT_KIND.AGENTS_MODELS_RETRY]: () => Promise.resolve(),
    [AGENT_ACT_KIND.AGENTS_PREFERENCES_RETRY]: () => Promise.resolve(),
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT_RETRY]: () => Promise.resolve(),
    ...procedures,
  };
  answeringPort = answered;
  installActPortClient(answered as ActPortClient);
}

export function fakeActPortCalls(): Partial<FakeActPort> {
  return answeringPort;
}

export function refusedOnPort(sentence: string): ORPCError<string, unknown> {
  return new ORPCError(ACT_ERROR.REFUSED, { message: sentence });
}

export interface OpenedLink {
  readonly kind: typeof TASKS_ACT_KIND.GITHUB_OPEN | typeof TASKS_ACT_KIND.WEB_OPEN;
  readonly payload: { readonly url: string };
}

export function openingLinks(
  opened: (link: OpenedLink) => void,
): Pick<FakeActPort, OpenedLink["kind"]> {
  return {
    [TASKS_ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      opened({ kind: TASKS_ACT_KIND.GITHUB_OPEN, payload: { url } });
      return Promise.resolve();
    },
    [TASKS_ACT_KIND.WEB_OPEN]: ({ url }) => {
      opened({ kind: TASKS_ACT_KIND.WEB_OPEN, payload: { url } });
      return Promise.resolve();
    },
  };
}

export function readingFiles(
  read: (request: TaskFileRequest) => Promise<TasksFileAnswer>,
): Pick<FakeActPort, typeof TASKS_ACT_KIND.TASKS_FILE> {
  return {
    [TASKS_ACT_KIND.TASKS_FILE]: ({ path, firstLine, lastLine, raw, ref }) =>
      read({
        path,
        firstLine,
        lastLine,
        ...(raw === undefined ? undefined : { raw }),
        ...(ref === undefined ? undefined : { ref }),
      }),
  };
}

export function answeringChanges(
  read: (agentId: string, number?: number) => Promise<AgentChangesAnswerView>,
): Pick<FakeActPort, typeof AGENT_ACT_KIND.AGENTS_CHANGES> {
  return {
    [AGENT_ACT_KIND.AGENTS_CHANGES]: (payload) =>
      "number" in payload && payload.number !== undefined
        ? read(payload.agentId, payload.number)
        : read(payload.agentId),
  };
}

export type FakeActPort = {
  readonly [Kind in PortActKind]: (payload: PortActPayload<Kind>) => Promise<PortActResult<Kind>>;
};

export type SentPortAct = { readonly kind: PortActKind; readonly payload?: WireBoundaryInput };

export function fakeActPortAnswering(
  answer: (request: SentPortAct) => Promise<WireBoundaryInput>,
): void {
  const procedures: Partial<FakeActPort> = {};
  for (const kind of Object.keys(actContract) as PortActKind[]) {
    Object.assign(procedures, {
      [kind]: (payload: WireBoundaryInput) =>
        answer(payload === undefined ? { kind } : { kind, payload }),
    });
  }
  fakeActPort(procedures);
}

type PortAct = {
  [Kind in PortActKind]: PortActPayload<Kind> extends undefined
    ? { readonly kind: Kind; readonly payload?: undefined }
    : { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[PortActKind];

export type AnyAct = PortAct;

export const FAKE_ANSWER = {
  DONE: "done",
  REFUSED: "refused",
  UNKNOWN_ACT: "unknown-act",
} as const;

export type FakeActAnswer =
  | { readonly status: typeof FAKE_ANSWER.DONE; readonly value: PortActResult<PortActKind> }
  | { readonly status: typeof FAKE_ANSWER.REFUSED; readonly reason: string }
  | { readonly status: typeof FAKE_ANSWER.UNKNOWN_ACT };

let answeringActs: ((request: AnyAct) => Promise<FakeActAnswer>) | undefined;

export function fakeActsAnswer(): (request: AnyAct) => Promise<FakeActAnswer> {
  const answer = answeringActs;
  if (answer === undefined) throw new Error("No acts are answered in this test yet.");
  return answer;
}

export function fakeActs(
  calls: Partial<AppBridge> & {
    readonly act: (request: AnyAct) => Promise<FakeActAnswer>;
  },
): void {
  const { act: answer, ...bridge } = calls;
  answeringActs = answer;
  fakeAppBridge(bridge);
  const procedures: Partial<FakeActPort> = {};
  const settled = (kind: PortActKind, outcome: FakeActAnswer): PortActResult<PortActKind> => {
    if (outcome.status === FAKE_ANSWER.DONE) return outcome.value;
    if (outcome.status === FAKE_ANSWER.REFUSED) throw refusedOnPort(outcome.reason);
    throw new Error(`Vespin does not know the act ${kind}.`);
  };
  const answered = async (request: PortAct): Promise<PortActResult<PortActKind>> =>
    settled(request.kind, await answer(request));
  for (const kind of Object.keys(actContract) as PortActKind[]) {
    Object.assign(procedures, {
      [kind]: async (payload: WireBoundaryInput) => {
        const request = (payload === undefined ? { kind } : { kind, payload }) as PortAct;
        if (!QUIET_HOLDS.has(request.kind)) return answered(request);
        const outcome = await answer(request);
        if (outcome.status === FAKE_ANSWER.DONE) return outcome.value;
        return quietHold();
      },
    });
  }
  fakeActPort(procedures);
}
