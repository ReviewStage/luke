import { ORPCError } from "@orpc/client";
import type { AGENT_CALL_FAILURE, AgentAgentAnswer } from "@repo/features/agent-view";
import { FAILURE_CONDITION, FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { ACT_UNREACHED_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  ACT_ERROR,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  type SettingUpdatePayload,
} from "@repo/host/contract";
import type { AppSettingField, AppSettingValue } from "@repo/settings";
import type { SettingsUpdateResult } from "@repo/settings/wire";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMemo } from "react";
import { actPort } from "./app-bridge.js";
import type { ShownFailure } from "./failure-report.js";
import { loadedTasksFixture } from "./tasks/tasks-fixture-loader.js";
import { showToast, TOAST_HOLD } from "./toast.js";
import { appStateNow } from "./use-app-state.js";

type ActPayloads = { readonly [Kind in PortActKind]: PortActPayload<Kind> };
type ActResults = { readonly [Kind in PortActKind]: PortActResult<Kind> };

type ActPayload<Kind extends PortActKind> = ActPayloads[Kind];

export type ActResult<Kind extends PortActKind> = ActResults[Kind];

type ActArguments<Kind extends PortActKind> =
  ActPayload<Kind> extends undefined ? [] : [payload: ActPayload<Kind>];

class ActRefusal extends Error {}

function stagedAnswer(
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  const fixture = loadedTasksFixture();
  if (fixture === undefined) return undefined;
  const run = appStateNow()?.run;
  if (run?.fixtureMode !== true) return undefined;
  return fixture.fixtureActAnswer(run, kind, payload);
}

async function portAct(
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): Promise<PortActResult<PortActKind>> {
  const staged = stagedAnswer(kind, payload);
  if (staged !== undefined) return staged.answer;
  try {
    const call = actPort()[kind] as (
      payload: PortActPayload<PortActKind>,
    ) => Promise<PortActResult<PortActKind>>;
    return await call(payload);
  } catch (error) {
    if (error instanceof ORPCError && error.code === ACT_ERROR.REFUSED) {
      throw new ActRefusal(error.message, { cause: error });
    }
    console.error(`The act ${kind} failed on its way to the service.`, error);
    throw new ActRefusal(ACT_UNREACHED_WORDS, { cause: error });
  }
}

async function performAct<Kind extends PortActKind>(
  kind: Kind,
  payload: ActPayload<Kind> | undefined,
): Promise<ActResult<Kind>> {
  return (await portAct(kind, payload as PortActPayload<PortActKind>)) as ActResult<Kind>;
}

export type ActVariables<Kind extends PortActKind> =
  ActPayload<Kind> extends undefined ? void : ActPayload<Kind>;

export function sendAct<Kind extends PortActKind>(
  kind: Kind,
  variables: ActVariables<Kind>,
): Promise<ActResult<Kind>> {
  return performAct(kind, variables as ActPayload<Kind> | undefined);
}

export function tellAct<Kind extends PortActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): void {
  void performAct(kind, payload).catch(() => undefined);
}

export function actFailureWords(error: unknown): string {
  return error instanceof ActRefusal ? error.message : ACT_UNREACHED_WORDS;
}

export function toastActFailure(failure: ShownFailure): void {
  showToast({
    words: actFailureWords(failure.cause),
    tone: STATUS_TONE.DANGER,
    hold: TOAST_HOLD.FAILED,
    failure,
  });
}

export function pressAct<Kind extends PortActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): Promise<void> {
  return performAct(kind, payload).then(
    () => undefined,
    (cause: unknown) =>
      toastActFailure({
        surface: FAILURE_SURFACE.ACT,
        act: kind,
        cause,
        about: failureAboutOf(payload),
      }),
  );
}

export type ActedResult = ActionResult & { readonly cause?: unknown };

export async function askActResult(asked: Promise<ActionResult>): Promise<ActedResult> {
  try {
    return await asked;
  } catch (error) {
    return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(error), cause: error };
  }
}

export type Kept = { readonly kept: true } | { readonly kept: false; readonly cause: unknown };

export const KEPT: Kept = { kept: true };

export function notKept(cause: unknown): Kept {
  return { kept: false, cause };
}

export function askKept(asked: Promise<boolean>): Promise<Kept> {
  return asked.then((kept) => (kept ? KEPT : notKept(FAILURE_CONDITION.NOT_KEPT)), notKept);
}

export function firstRefusal(answers: readonly Kept[]): unknown {
  const refused = answers.find((answer) => !answer.kept);
  return refused === undefined || refused.kept ? undefined : refused.cause;
}

export interface Unreached<Failure extends string> {
  readonly failure: Failure;
  readonly cause: unknown;
}

export type AgentActAnswer = AgentAgentAnswer | Unreached<typeof AGENT_CALL_FAILURE.UNANSWERED>;

export function unreachedAs<const Failure extends string>(failure: Failure) {
  return (cause: unknown): Unreached<Failure> => ({ failure, cause });
}

export function askAct<Kind extends PortActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): Promise<ActResult<Kind>> {
  return performAct<Kind>(kind, payload);
}

interface SettingWriteActs {
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult>;
}

export interface ActHandle extends SettingWriteActs {
  act: typeof askAct;
  press: typeof pressAct;
  tell: typeof tellAct;
}

export function useAct(): ActHandle {
  return useMemo<ActHandle>(
    () => ({
      act: askAct,
      press: pressAct,
      tell: tellAct,
      updateSetting: (field, value) =>
        askAct(ACT_KIND.SETTING_UPDATE, { field, value } as SettingUpdatePayload),
    }),
    [],
  );
}
