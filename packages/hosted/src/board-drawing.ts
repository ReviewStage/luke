import { BOARD_ELEMENT_TYPE, DRAWING_STEP_TYPE, LUKE_MARK } from "./board-vocabulary.js";
import type { Board, BoardElement, DrawingStep } from "./board-wire.js";

/**
 * board-drawing.ts -- the elements a board will hold once every drawing of Luke's is on it, and why a new drawing could not be put there.
 *
 * The service never sees the Mac convert a drawing, but it knows enough to
 * hold one to the rules the Mac applies it by: the scene's elements by id,
 * which of them are Luke's (`LUKE_MARK`), and the drawings still on their way,
 * applied in order. A drawing that is not a restore first takes Luke's
 * elements off; then each step applies in order, a `delete` taking off
 * elements of Luke's and every other element going on under an id the board
 * does not hold. An arrow's ends are checked once the whole drawing has
 * applied, so an arrow may name a shape drawn after it, and may join any
 * shape or text on the board, the developer's included.
 *
 * Note that a drawing on its way applies leniently: the developer may have
 * erased an element of Luke's after the drawing that deletes it was written,
 * and the Mac skips what is no longer there, so this does too. Labels are not
 * elements of their own here, since a label goes on and off with its shape.
 */

/** Why a drawing could not be put on the board. */
export const DRAWING_FAULT = {
  /** An element's id is one the board already holds, or one the drawing uses twice. */
  TAKEN_ID: "taken-id",
  /** A `delete` names an id that is not one of Luke's elements on the board. */
  NOT_LUKES: "not-lukes",
  /** An arrow names an end that is not a shape or text on the board. */
  NO_END: "no-end",
} as const;

export type DrawingFault = (typeof DRAWING_FAULT)[keyof typeof DRAWING_FAULT];

/** What a drawing's rules need of it: whether it is a restore, and its steps. */
export interface DrawingRequest {
  readonly restore: boolean;
  readonly elements: readonly DrawingStep[];
}

interface StandingElement {
  readonly type: string;
  readonly lukes: boolean;
}

const ARROW_ENDS: ReadonlySet<string> = new Set([
  BOARD_ELEMENT_TYPE.RECTANGLE,
  BOARD_ELEMENT_TYPE.ELLIPSE,
  BOARD_ELEMENT_TYPE.DIAMOND,
  BOARD_ELEMENT_TYPE.FRAME,
  BOARD_ELEMENT_TYPE.TEXT,
]);

function isLabel(element: BoardElement): boolean {
  return element.type === BOARD_ELEMENT_TYPE.TEXT && Boolean(element.containerId);
}

/** Whether an element of the scene was made from a drawing of Luke's. */
export function isLukes(element: BoardElement): boolean {
  return element.customData?.drawnBy === LUKE_MARK.drawnBy;
}

/** A board's elements by id as they will stand once every drawing on its way is on it. */
export class StandingBoard {
  private readonly scene: ReadonlyMap<string, StandingElement>;
  private readonly standing: Map<string, StandingElement>;

  private constructor(scene: ReadonlyMap<string, StandingElement>) {
    this.scene = scene;
    this.standing = new Map(scene);
  }

  static of(board: Board): StandingBoard {
    const scene = new Map(
      board.elements
        .filter((element) => !isLabel(element))
        .map((element) => [element.id, { type: element.type, lukes: isLukes(element) }] as const),
    );
    const standing = new StandingBoard(scene);
    for (const drawing of board.drawings) standing.apply(drawing, { strict: false });
    return standing;
  }

  /** Ids a drawing on its way puts on the board, which the scene does not hold yet. */
  get arriving(): readonly string[] {
    return [...this.standing.keys()].filter((id) => !this.scene.has(id));
  }

  /** Ids of the scene a drawing on its way takes off. */
  get leaving(): readonly string[] {
    return [...this.scene.keys()].filter((id) => !this.standing.has(id));
  }

  /** Why the drawing could not be put on the board as it will stand, or nothing where it can. */
  refusalOf(drawing: DrawingRequest): DrawingFault | undefined {
    const trial = new StandingBoard(this.standing);
    return trial.apply(drawing, { strict: true });
  }

  private apply(
    drawing: DrawingRequest,
    { strict }: { strict: boolean },
  ): DrawingFault | undefined {
    if (!drawing.restore) {
      for (const [id, element] of this.standing) if (element.lukes) this.standing.delete(id);
    }
    for (const step of drawing.elements) {
      switch (step.type) {
        case DRAWING_STEP_TYPE.CAMERA:
          break;
        case DRAWING_STEP_TYPE.DELETE:
          for (const id of step.ids) {
            if (strict && this.standing.get(id)?.lukes !== true) return DRAWING_FAULT.NOT_LUKES;
            this.standing.delete(id);
          }
          break;
        default:
          if (strict && this.standing.has(step.id)) return DRAWING_FAULT.TAKEN_ID;
          this.standing.set(step.id, { type: step.type, lukes: true });
      }
    }
    if (!strict) return undefined;
    const ends = drawing.elements.flatMap((step) =>
      step.type === BOARD_ELEMENT_TYPE.ARROW ? [step.from, step.to] : [],
    );
    const joinable = ends.every((end) => ARROW_ENDS.has(this.standing.get(end)?.type ?? ""));
    return joinable ? undefined : DRAWING_FAULT.NO_END;
  }
}
