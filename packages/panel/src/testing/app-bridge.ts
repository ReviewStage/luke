/**
 * app-bridge.ts -- the bridge and act port a test's window reaches main through: fakes answering only the calls its test gives them.
 */

import { ORPCError } from "@orpc/client";
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

/** Installs a bridge answering only the calls given, in place of whatever the window held. */
export function fakeAppBridge(calls: Partial<AppBridge>): void {
  answering = calls;
  // SAFETY: a test's window makes only the calls its test answers, and any other is undefined and throws where it is made.
  installAppBridge(calls as AppBridge);
}

/** The calls the fake bridge answers now, for a test that answers one more beside them or puts them back. */
export function fakeAppBridgeCalls(): Partial<AppBridge> {
  return answering;
}

/** The holds a window keeps on a read the host lays on app state: a task's or an agent's inbox, its pages and cloud Browser tabs, a pull request's chapters and parts, the account's beats, hosts, models, integrations, provider keys, and GitHub token, an agent's or a server's tools, the outside MCP clients, a workspace's memories, skills, and repositories, a link's standing, the automations' lists and histories, a plan's or a page's comments, a task's plan history, the run that started an agent, a workspace's people, token repositories, invitations, own integrations, and Slack channels, and a task's plan. */
type HoldKind =
  | typeof AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW
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

/** Every hold a window keeps on a read the host lays on app state, which a test's port holds quietly unless it answers it. */
const QUIET_HOLDS: ReadonlySet<PortActKind> = new Set<HoldKind>([
  AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW,
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

/** A hold as the host answers it: a stream carrying nothing, standing until the window closes it. */
export function quietHold<Kind extends HoldKind>(): Promise<PortActResult<Kind>> {
  return heldUntilClosed<Kind>(() => undefined);
}

/** A hold as the host answers it, as `quietHold`, telling `closed` as the window closes it. */
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
  // SAFETY: the window reads oRPC's stream as an async iterator alone, which this is.
  return Promise.resolve(stream as unknown as PortActResult<Kind>);
}

/**
 * Installs an act port answering only the procedures given, each by its
 * kind, as a test's window calls them. A hold it does not answer, on a
 * task's or an agent's inbox or pages, a pull request's chapters or parts,
 * the account's beats, hosts, models, integrations, provider keys, or GitHub token,
 * an agent's or a server's tools, the outside MCP clients, a workspace's
 * memories, skills, or repositories, a link's standing, the automations'
 * lists and histories, a plan's or a page's comments, a task's plan
 * history, the run that started an agent, a workspace's people, token
 * repositories, own integrations, or Slack channels, or a task's plan, is
 * held quietly, and an automations', the integrations', the memories', the
 * skills', a repository list's, a workspace's integrations', its Slack
 * channels', the models', or the preferences' Try again taken, since what
 * the hold reads reaches the window on app state.
 */
export function fakeActPort(procedures: Partial<FakeActPort>): void {
  // Note that the host's holds are answered quietly unless the test answers them, since their reads arrive on app state.
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
    ...procedures,
  };
  answeringPort = answered;
  // SAFETY: a test's window calls only the procedures its test answers, and any other is undefined and throws where it is called.
  installActPortClient(answered as ActPortClient);
}

/** The procedures the fake act port answers now, for a test that answers one more beside them or puts them back. */
export function fakeActPortCalls(): Partial<FakeActPort> {
  return answeringPort;
}

/** A procedure's refusal as the act port answers it: the declared error, carrying `sentence`. */
export function refusedOnPort(sentence: string): ORPCError<string, unknown> {
  return new ORPCError(ACT_ERROR.REFUSED, { message: sentence });
}

/** A page a press opened in the browser, as the act that opened it. */
export interface OpenedLink {
  readonly kind: typeof TASKS_ACT_KIND.GITHUB_OPEN | typeof TASKS_ACT_KIND.WEB_OPEN;
  readonly payload: { readonly url: string };
}

/**
 * The act port's two link openers, each handing `opened` the page it opened
 * as the act it was, for a test to spread into its `fakeActPort`.
 */
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

/** Each port kind's procedure as a test answers it: its payload in, its answer or a rejection out. */
export type FakeActPort = {
  readonly [Kind in PortActKind]: (payload: PortActPayload<Kind>) => Promise<PortActResult<Kind>>;
};

/** One act as a window sent it on its act port: its kind, and its payload where it carries one. */
export type SentPortAct = { readonly kind: PortActKind; readonly payload?: WireBoundaryInput };

/**
 * Installs an act port answering every kind through `answer`, as a test
 * that writes down what its window sent, whichever kind it was, does.
 */
export function fakeActPortAnswering(
  answer: (request: SentPortAct) => Promise<WireBoundaryInput>,
): void {
  const procedures: Partial<FakeActPort> = {};
  // SAFETY: the contract's keys are exactly its kinds.
  for (const kind of Object.keys(actContract) as PortActKind[]) {
    // Note that each kind is answered alike, whatever its own answer is, so it is assigned rather than typed by the kind.
    Object.assign(procedures, {
      [kind]: (payload: WireBoundaryInput) =>
        answer(payload === undefined ? { kind } : { kind, payload }),
    });
  }
  fakeActPort(procedures);
}

/** One act a window sent on its act port, its payload typed by its kind, and absent where the kind carries none. */
type PortAct = {
  [Kind in PortActKind]: PortActPayload<Kind> extends undefined
    ? { readonly kind: Kind; readonly payload?: undefined }
    : { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[PortActKind];

/** One act a test's window sent on its act port, its payload typed by its kind. */
export type AnyAct = PortAct;

/** How a test's switch answers an act: with the kind's value, refused in a sentence, or not at all. */
export const FAKE_ANSWER = {
  DONE: "done",
  REFUSED: "refused",
  /** A kind the switch does not answer, which the port rejects as a kind this build does not know. */
  UNKNOWN_ACT: "unknown-act",
} as const;

/** What a test's switch answers any act with: a kind's value, a refusal's sentence, or no answer. */
export type FakeActAnswer =
  | { readonly status: typeof FAKE_ANSWER.DONE; readonly value: PortActResult<PortActKind> }
  | { readonly status: typeof FAKE_ANSWER.REFUSED; readonly reason: string }
  | { readonly status: typeof FAKE_ANSWER.UNKNOWN_ACT };

let answeringActs: ((request: AnyAct) => Promise<FakeActAnswer>) | undefined;

/** The answer {@link fakeActs} installed last, for a test that answers a kind more over it. */
export function fakeActsAnswer(): (request: AnyAct) => Promise<FakeActAnswer> {
  const answer = answeringActs;
  if (answer === undefined) throw new Error("No acts are answered in this test yet.");
  return answer;
}

/**
 * Installs an act port answered by `calls.act`, as a test whose one switch
 * answers every kind does: a done answer is the kind's bare value, a refusal
 * is the port's refusal in its sentence, and a kind the switch does not know
 * rejects. The bridge's calls are the rest of `calls`.
 */
export function fakeActs(
  calls: Partial<AppBridge> & {
    readonly act: (request: AnyAct) => Promise<FakeActAnswer>;
  },
): void {
  const { act: answer, ...bridge } = calls;
  answeringActs = answer;
  fakeAppBridge(bridge);
  const procedures: Partial<FakeActPort> = {};
  /** One act answered by the switch: the kind's value, or the port's refusal or rejection. */
  const settled = (kind: PortActKind, outcome: FakeActAnswer): PortActResult<PortActKind> => {
    if (outcome.status === FAKE_ANSWER.DONE) return outcome.value;
    if (outcome.status === FAKE_ANSWER.REFUSED) throw refusedOnPort(outcome.reason);
    throw new Error(`Vespin does not know the act ${kind}.`);
  };
  const answered = async (request: PortAct): Promise<PortActResult<PortActKind>> =>
    settled(request.kind, await answer(request));
  // SAFETY: the contract's keys are exactly its kinds.
  for (const kind of Object.keys(actContract) as PortActKind[]) {
    // Note that each kind is answered alike, whatever its own answer is, so it is assigned rather than typed by the kind.
    Object.assign(procedures, {
      [kind]: async (payload: WireBoundaryInput) => {
        // SAFETY: the window paired this payload with this kind, as its own procedure takes it.
        const request = (payload === undefined ? { kind } : { kind, payload }) as PortAct;
        if (!QUIET_HOLDS.has(request.kind)) return answered(request);
        // A hold the switch does not answer is held quietly, as the host holds one, its read laid on app state.
        const outcome = await answer(request);
        if (outcome.status === FAKE_ANSWER.DONE) return outcome.value;
        return quietHold();
      },
    });
  }
  fakeActPort(procedures);
}
