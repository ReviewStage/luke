import { RUNNER_END, RUNNER_EVENT, type RunnerEnd } from "@luke/agent-runner/protocol";
import {
  TOOL_CALL_SETTLEMENT,
  type ToolCallSettlement,
  toolCallSettlementOf,
} from "@luke/features/brain";
import { redactCredentials } from "@luke/features/credential-redaction";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireValue,
} from "@luke/wire";
import { Option, Schema } from "effect";
import {
  NATIVE_ENDING,
  NATIVE_MOMENT,
  type NativeMoment,
  type NativeWakeup,
} from "./native-moments.js";

/**
 * runner-moments.ts -- what every harness's reader reads alike: the runner's own events, and a tool's answer as the transcript settles its call.
 *
 * The runner posts its own events (`@luke/agent-runner/protocol`) among its
 * harness's messages, the same for Claude Code and Codex: a line Luke handed
 * the harness, the launch waiting on work in flight, the agent's turn over
 * with the launch kept warm, and the launch's end. A
 * tool's answer is settled the same way whichever harness ran it: a Luke
 * tool's as the JSON it answered, any other's as the text the model read.
 */

/** How long the turn's record keeps a failure the harness reported, inside the writer's own bound. */
export const FAILURE_CHARS = 300;

/** What a picture in a tool's answer is kept as: the bytes went to the model once, and a transcript carries every byte it holds into each read. */
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

/** How each of the runner's endings reads on the turn. */
const ENDING_OF_RUNNER_END = {
  [RUNNER_END.TURN_ENDED]: NATIVE_ENDING.DONE,
  [RUNNER_END.RELEASED]: NATIVE_ENDING.DONE,
  [RUNNER_END.STOPPED]: NATIVE_ENDING.STOPPED,
  [RUNNER_END.INPUT_CLOSED]: NATIVE_ENDING.FAILED,
  [RUNNER_END.FAILED]: NATIVE_ENDING.FAILED,
  // A warm launch's turn already ended at its IDLE, so this end finds none to settle.
  [RUNNER_END.IDLED]: NATIVE_ENDING.DONE,
} as const satisfies Record<RunnerEnd, (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING]>;

/** The ends that are no failure, which carry no detail. */
const QUIET_ENDS: ReadonlySet<RunnerEnd> = new Set([
  RUNNER_END.TURN_ENDED,
  RUNNER_END.RELEASED,
  RUNNER_END.STOPPED,
  RUNNER_END.IDLED,
]);

/**
 * The wakeups an end leaves the agent: a released wait's, each whose
 * instant reads, or none for a Stop; nothing for any other end, which
 * leaves the agent's wakeups as they stood.
 */
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
        : { detail: redactCredentials(said).slice(0, FAILURE_CHARS) }),
      ...(wakeups === undefined ? undefined : { wakeups }),
    },
  ];
}

/**
 * One of the runner's own events as the moments of the run, or nothing
 * where the message is no event of the runner's, so the harness's reader
 * reads it.
 */
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
    // The agent's turn is over, as a `turn_ended` END says, though the launch stays warm.
    case RUNNER_EVENT.IDLE:
      return Option.some([{ kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE }]);
    case RUNNER_EVENT.END:
      return Option.some(endMoments(message));
    default:
      return Option.none();
  }
}

/**
 * A tool's answer as the transcript settles its call: an error the harness
 * flagged is a refusal carrying the text, and any other answer is available.
 * A Luke tool's answer is read as the JSON it answers, so its status word
 * counts as the eve relay counts it; any other tool's is kept as `output`,
 * the text the model read or what the harness reported of the call.
 */
export function toolAnswerSettlement(
  answer:
    | { readonly lukeTool: true; readonly text: string }
    | { readonly lukeTool: false; readonly text: string; readonly output: UnparsedWireValue },
  isError: boolean,
): ToolCallSettlement {
  const output: UnparsedWireValue = answer.lukeTool
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
  if (!answer.lukeTool) return toolCallSettlementOf(JSON.stringify(answer.output), undefined);
  const status = isRecord(output) && isWireString(output.status) ? output.status : undefined;
  return toolCallSettlementOf(answer.text, status);
}
