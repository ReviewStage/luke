/**
 * app-bridge.ts -- the bridge and act port a test's window reaches main through: fakes answering only the calls its test gives them.
 */

import { AUTOMATION_FOLLOW, type AutomationFollow } from "@luke/features/automation-view";
import type { AppBridge } from "@luke/host/bridge";
import {
  ACT_ERROR,
  type ActPortClient,
  AUTOMATION_ACT_KIND,
  actContract,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
} from "@luke/host/contract";
import type { WireBoundaryInput } from "@luke/wire";
import { ORPCError } from "@orpc/client";
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

/** What a follow of the automations pushes: a workspace's list, or an automation's runs. */
type FollowedView =
  PortActResult<typeof AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW> extends AsyncIteratorObject<
    infer View,
    unknown,
    unknown
  >
    ? View
    : never;

/** A stream that hands what `first` answers and then stands open, as the host's follow does while nothing moves, until the window closes it. */
function heldOpen(
  first: Promise<FollowedView>,
): AsyncIteratorObject<FollowedView, undefined, unknown> {
  let handed = false;
  const ended = Promise.withResolvers<IteratorReturnResult<undefined>>();
  const closed = ended.promise;
  const close = () => ended.resolve({ done: true, value: undefined });
  const stream: AsyncIteratorObject<FollowedView, undefined, unknown> = {
    next: async () => {
      if (handed) return closed;
      handed = true;
      return { done: false, value: await first };
    },
    return: async () => {
      close();
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]: () => stream,
    [Symbol.asyncDispose]: async () => {
      close();
    },
  };
  return stream;
}

/**
 * A follow of the automations a test does not answer itself, answered from
 * the one-shot read it does answer: a workspace's list, or an automation's
 * runs, pushed once and held open.
 */
function followedFromReads(
  read: (scope: AutomationFollow) => Promise<FollowedView>,
): (
  scope: AutomationFollow,
) => Promise<PortActResult<typeof AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW>> {
  // SAFETY: the window reads oRPC's stream as an async iterator alone, which this is.
  return (scope) =>
    Promise.resolve(
      heldOpen(read(scope)) as unknown as PortActResult<
        typeof AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW
      >,
    );
}

/**
 * Installs an act port answering only the procedures given, each by its
 * kind, as a test's window calls them. A follow of the automations it does
 * not answer is answered from the list's or the runs' read where it answers
 * that.
 */
export function fakeActPort(procedures: Partial<FakeActPort>): void {
  const list = procedures[AUTOMATION_ACT_KIND.AUTOMATIONS_LIST];
  const runs = procedures[AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS];
  const answered: Partial<FakeActPort> =
    procedures[AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW] !== undefined ||
    (list === undefined && runs === undefined)
      ? procedures
      : {
          ...procedures,
          [AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW]: followedFromReads((scope) => {
            const read =
              scope.kind === AUTOMATION_FOLLOW.WORKSPACE
                ? list?.({ workspaceId: scope.id })
                : runs?.({ automationId: scope.id });
            return read ?? Promise.reject(new Error("Not in this test."));
          }),
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
    throw new Error(`Luke does not know the act ${kind}.`);
  };
  const answered = async (request: PortAct): Promise<PortActResult<PortActKind>> =>
    settled(request.kind, await answer(request));
  // A follow of the automations the switch does not answer, or refuses as one not in its test, is answered from its list's or runs' read.
  const followed = followedFromReads(
    (scope) =>
      // SAFETY: a list's read answers a workspace's list, and a runs' read an automation's runs.
      answered(
        scope.kind === AUTOMATION_FOLLOW.WORKSPACE
          ? { kind: AUTOMATION_ACT_KIND.AUTOMATIONS_LIST, payload: { workspaceId: scope.id } }
          : { kind: AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS, payload: { automationId: scope.id } },
      ) as Promise<FollowedView>,
  );
  // SAFETY: the contract's keys are exactly its kinds.
  for (const kind of Object.keys(actContract) as PortActKind[]) {
    // Note that each kind is answered alike, whatever its own answer is, so it is assigned rather than typed by the kind.
    Object.assign(procedures, {
      [kind]: async (payload: WireBoundaryInput) => {
        // SAFETY: the window paired this payload with this kind, as its own procedure takes it.
        const request = (payload === undefined ? { kind } : { kind, payload }) as PortAct;
        if (request.kind !== AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW) return answered(request);
        const outcome = await answer(request);
        if (outcome.status === FAKE_ANSWER.DONE) return outcome.value;
        return followed(request.payload);
      },
    });
  }
  fakeActPort(procedures);
}
