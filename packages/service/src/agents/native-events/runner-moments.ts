import { RUNNER_END, RUNNER_EVENT, type RunnerEnd } from "@repo/agent-runner/protocol";
import { redactCredentials } from "@repo/features/credential-redaction";
import {
  TOOL_CALL_SETTLEMENT,
  type ToolCallSettlement,
  toolCallSettlementOf,
} from "@repo/features/turn-run";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireValue,
} from "@repo/wire";
import { Option, Schema } from "effect";
import {
  NATIVE_ENDING,
  NATIVE_MOMENT,
  type NativeMoment,
  type NativeWakeup,
} from "./native-moments.js";

export const FAILURE_CHARS = 300;

const END_DETAIL_CHARS = 1000;

const PLAN_CODE_SPLIT = /((?<![^\s"'])(?:subscription_sharing|chatpass_v2)_[a-z_]+(?![^\s"',;]))/;

export const PICTURE_STAND_IN = "[image]";

const readType = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.String }));
const readAccepted = Schema.decodeUnknownOption(Schema.Struct({ uuid: Schema.String }));
const readEnd = Schema.decodeUnknownOption(
  Schema.Struct({
    reason: Schema.Literals(Object.values(RUNNER_END)),
    detail: Schema.optionalKey(Schema.String),
    wakeups: Schema.optionalKey(
      Schema.Array(Schema.Struct({ at: Schema.String, prompt: Schema.String })),
    ),
  }),
);

const ENDING_OF_RUNNER_END = {
  [RUNNER_END.TURN_ENDED]: NATIVE_ENDING.DONE,
  [RUNNER_END.RELEASED]: NATIVE_ENDING.DONE,
  [RUNNER_END.STOPPED]: NATIVE_ENDING.STOPPED,
  [RUNNER_END.INPUT_CLOSED]: NATIVE_ENDING.FAILED,
  [RUNNER_END.FAILED]: NATIVE_ENDING.FAILED,
  [RUNNER_END.IDLED]: NATIVE_ENDING.DONE,
} as const satisfies Record<RunnerEnd, (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING]>;

const QUIET_ENDS: ReadonlySet<RunnerEnd> = new Set([
  RUNNER_END.TURN_ENDED,
  RUNNER_END.RELEASED,
  RUNNER_END.STOPPED,
  RUNNER_END.IDLED,
]);

function wakeupsOf(
  reason: RunnerEnd,
  wakeups: readonly { readonly at: string; readonly prompt: string }[] | undefined,
): readonly NativeWakeup[] | undefined {
  if (reason === RUNNER_END.STOPPED) return [];
  if (reason !== RUNNER_END.RELEASED) return undefined;
  return (wakeups ?? []).flatMap(({ at, prompt }) => {
    const due = Date.parse(at);
    return Number.isNaN(due) ? [] : [{ at: due, prompt }];
  });
}

function endMoments(message: WireValue): readonly NativeMoment[] {
  const read = readEnd(message);
  if (Option.isNone(read)) return [];
  const { reason, detail } = read.value;
  const said = detail === undefined ? reason : `${reason} ${detail}`;
  const wakeups = wakeupsOf(reason, read.value.wakeups);
  return [
    {
      kind: NATIVE_MOMENT.ENDED,
      ending: ENDING_OF_RUNNER_END[reason],
      ...(QUIET_ENDS.has(reason)
        ? undefined
        : { detail: redactKeepingPlanCodes(said).slice(0, END_DETAIL_CHARS) }),
      ...(reason === RUNNER_END.FAILED ? { launchFailed: true } : undefined),
      ...(wakeups === undefined ? undefined : { wakeups }),
    },
  ];
}

export function redactKeepingPlanCodes(text: string): string {
  return text
    .split(PLAN_CODE_SPLIT)
    .map((part, index) => (index % 2 === 1 ? part : redactCredentials(part)))
    .join("");
}

export function runnerMoments(message: WireValue): Option.Option<readonly NativeMoment[]> {
  const type = Option.map(readType(message), (read) => read.type);
  if (Option.isNone(type)) return Option.none();
  switch (type.value) {
    case RUNNER_EVENT.ACCEPTED:
      return Option.some(
        Option.match(readAccepted(message), {
          onSome: ({ uuid }): readonly NativeMoment[] => [
            { kind: NATIVE_MOMENT.LINE_ACCEPTED, clientId: uuid },
          ],
          onNone: () => [],
        }),
      );
    case RUNNER_EVENT.WAITING:
      return Option.some([{ kind: NATIVE_MOMENT.WAITING }]);
    case RUNNER_EVENT.IDLE:
      return Option.some([{ kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE, warm: true }]);
    case RUNNER_EVENT.END:
      return Option.some(endMoments(message));
    default:
      return Option.none();
  }
}

export function toolAnswerSettlement(
  answer:
    | { readonly workspaceTool: true; readonly text: string }
    | { readonly workspaceTool: false; readonly text: string; readonly output: UnparsedWireValue },
  isError: boolean,
): ToolCallSettlement {
  const output: UnparsedWireValue = answer.workspaceTool
    ? valueFromJsonText(answer.text)
    : answer.output;
  if (isError) {
    return {
      state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
      output,
      errorText: answer.text,
      status: ACTION_RESULT_STATUS.REJECTED,
    };
  }
  if (!answer.workspaceTool) return toolCallSettlementOf(JSON.stringify(answer.output), undefined);
  const status = isRecord(output) && isWireString(output.status) ? output.status : undefined;
  return toolCallSettlementOf(answer.text, status);
}
