import { LOOK_AT_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";
import { Duration, Effect, Option, Schedule, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { ToolModelOutput } from "eve/tools";
import { readBoardImage } from "./board-store.js";
import type { PlanDocumentBinding } from "./plan-notes.js";

/**
 * board-look.ts -- `look_at_board`, the planning model's eyes on the plan's whiteboard: its latest drawing as the developer's Mac drew it, handed back as an image.
 *
 * Excalidraw's own guides for a model that draws ask it to look at what it
 * drew and fix what it sees before it moves on: text cut off, shapes on top
 * of one another, an arrow through a shape. `draw_on_board`'s layout findings
 * (`board-layout.ts`) catch what coordinates show; only a picture shows the
 * rest, and only the Mac can draw one, since its canvas measures the text and
 * places Luke's drawing beside the developer's. The Mac already puts each new
 * drawing on the board the moment the draw settles, while the board is open,
 * and its first save of the scene that holds it carries the scene drawn as a
 * PNG (`board-store.ts`); and while a look is the call pending, which the Mac
 * reads off the planning call's activity, the open board saves itself with
 * its image again. So a look asks the Mac nothing directly: it waits a short
 * while for an image of the scene as it holds the latest drawing, and says
 * the board is not open when none landed.
 *
 * The image reaches the model as an image (`lookModelOutput`), never as its
 * base64 spelled out as text, and stays out of the conversation's stored
 * messages (`storedLookOutput`): what the model saw once is no record of the
 * plan, and a board's picture is hundreds of kilobytes.
 */

/** Why a call shows nothing, in words the model can act on. */
export const LOOK_AT_BOARD_REFUSAL = {
  UNREADABLE: "Not looked: the tool takes no arguments.",
  NOT_OPEN:
    "Not looked: the board is not open on the developer's Mac, so your latest drawing is not " +
    "drawn yet. Do not look again this turn; rely on draw_on_board's layout findings.",
  FAILED: "Not looked: the board could not be read. The call may be made again.",
} as const;

export const LOOK_AT_BOARD_STATUS = {
  LOOKED: "looked",
  NOT_LOOKED: "not-looked",
} as const;

/** How long a look waits for the Mac's image of the latest drawing, and how often it reads. */
export const BOARD_LOOK_WAIT = {
  POLL: Duration.millis(250),
  DEADLINE: Duration.seconds(8),
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type LookAtBoardResult =
  | { readonly status: typeof LOOK_AT_BOARD_STATUS.LOOKED; readonly image: string }
  | { readonly status: typeof LOOK_AT_BOARD_STATUS.NOT_LOOKED; readonly reason: string };

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const LOOK_AT_BOARD_TOOL = {
  name: LOOK_AT_BOARD_TOOL_NAME,
  description:
    "See the plan's whiteboard as the developer sees it: an image of the whole board, your " +
    "latest drawing and what they drew. Call it after draw_on_board, and check that every " +
    "label is whole, nothing overlaps, and no arrow crosses a shape it does not join; then fix " +
    "what you see by drawing again. Answers the image, or `not-looked` and why.",
  inputSchema: Schema.Struct({}),
} as const;

const LOOK_MEDIA_TYPE = "image/png";

/** A settled look's result, as the model's and the store's views of it read one. */
const isLooked = Schema.is(
  Schema.Struct({ status: Schema.Literal(LOOK_AT_BOARD_STATUS.LOOKED), image: Schema.String }),
);

/** Whether a call's arguments are the none the tool takes. Note that an empty struct admits any key, so this counts them. */
function takesNothing(input: UnparsedWireValue): boolean {
  return isRecord(input) && Object.keys(input).length === 0;
}

/**
 * One call of `look_at_board`: the board's image once a save of the scene
 * holding the latest drawing has carried one, or `not-looked` when none did
 * by the deadline.
 */
export function runLookAtBoard(
  binding: PlanDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<LookAtBoardResult, never, SqlClient.SqlClient> {
  if (!takesNothing(input)) {
    return Effect.succeed({
      status: LOOK_AT_BOARD_STATUS.NOT_LOOKED,
      reason: LOOK_AT_BOARD_REFUSAL.UNREADABLE,
    });
  }
  const awaited = readBoardImage(binding.userId, binding.planId).pipe(
    Effect.repeat({ schedule: Schedule.spaced(BOARD_LOOK_WAIT.POLL), until: Option.isSome }),
    Effect.timeoutOption(BOARD_LOOK_WAIT.DEADLINE),
    Effect.map(Option.flatten),
  );
  return awaited.pipe(
    Effect.map(
      (image): LookAtBoardResult =>
        Option.match(image, {
          onNone: () => ({
            status: LOOK_AT_BOARD_STATUS.NOT_LOOKED,
            reason: LOOK_AT_BOARD_REFUSAL.NOT_OPEN,
          }),
          onSome: (drawn) => ({ status: LOOK_AT_BOARD_STATUS.LOOKED, image: drawn }),
        }),
    ),
    Effect.catch(() =>
      Effect.succeed<LookAtBoardResult>({
        status: LOOK_AT_BOARD_STATUS.NOT_LOOKED,
        reason: LOOK_AT_BOARD_REFUSAL.FAILED,
      }),
    ),
  );
}

/**
 * What the model is shown of a call's result: a look's image as an image, and
 * anything else as the JSON it is. Note that the output is eve's literal
 * shape, spelled here rather than built with eve's helpers, because this
 * module is in every function's bundle and eve's runtime belongs in none.
 */
export function lookModelOutput(output: UnparsedWireValue): ToolModelOutput {
  if (!isLooked(output)) return { type: "json", value: output };
  return {
    type: "content",
    value: [
      {
        type: "text",
        text: "The plan's whiteboard, as the developer sees it:",
      },
      { type: "file", data: { type: "data", data: output.image }, mediaType: LOOK_MEDIA_TYPE },
    ],
  };
}

/** A call's result as the conversation keeps it: a look's status without its image. */
export function storedLookOutput(output: UnparsedWireValue): UnparsedWireValue {
  return isLooked(output) ? unparsedWire({ status: output.status }) : output;
}
