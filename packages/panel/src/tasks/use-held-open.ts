/**
 * use-held-open.ts -- a task asked to open is drawn once its content is in hand, what stood holding the window meanwhile, so the two meet in one view transition rather than through the task's skeleton.
 *
 * The host answers an open at once with the task reading and draws its
 * document a round trip later (`compose-tasks.ts`'s `TASKS_OPEN`). Its state
 * arrives through an external store, whose updates React never runs as a
 * transition, so no view transition can ride them. Instead, while a task
 * asked to open here is read, the window goes on drawing the task and the
 * place that stood, and once the read lands (ready, failed, or gone) the
 * page turns to it inside `navigate`, which React plays as a view
 * transition. A read that has not landed by `--luke-late-delay` turns the
 * page at once, to the skeleton, as every open did before.
 */

import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@luke/brand";
import type { TasksView } from "@luke/features/tasks-view";
import { milliseconds, NAVIGATION, navigate } from "@luke/ui";
import { DOCUMENT_REGION, documentRegion } from "@luke/ui/tasks-model";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** The token a held open waits out before it turns the page anyway, which a capture run zeroes. */
const LATE_DELAY_TOKEN = "--luke-late-delay";

/** The part of the host's view that says which task the page draws, and its document. */
interface DrawnOpen {
  readonly activeTaskId: string | undefined;
  readonly document: TasksView["document"];
}

/** What a held open hands the window: the view to draw, and the asks that hold and let go. */
export interface HeldOpen {
  /** The host's view, but the task and document that stood while an open is held. */
  readonly view: TasksView;
  /** Holds what stands until the task asked for lands. */
  readonly await: (taskId: string) => void;
  /** Lets go of an open asked for, which the host refused. */
  readonly release: (taskId: string) => void;
}

function drawnOf(view: TasksView): DrawnOpen {
  return { activeTaskId: view.activeTaskId, document: view.document };
}

/** The host's view with the task and document that stood in place of its own. */
function heldView(view: TasksView, drawn: DrawnOpen): TasksView {
  const { activeTaskId: _turnedTo, ...rest } = view;
  return drawn.activeTaskId === undefined
    ? { ...rest, document: drawn.document }
    : { ...rest, activeTaskId: drawn.activeTaskId, document: drawn.document };
}

/**
 * How long a held open waits, read where a capture run sets it. Note that a
 * window no stylesheet has drawn sets nothing, and waits the brand's own delay.
 */
function lateDelay(): number {
  const value = getComputedStyle(document.body).getPropertyValue(LATE_DELAY_TOKEN);
  return value.trim() === "" ? MOTION_DELAY_MS.LATE : milliseconds(value);
}

/** One held open's wait, as an atom whose work is the wait, as `settle-wait.ts`'s is. */
function lateWait() {
  return Atom.fn(({ delay, late }: { readonly delay: number; readonly late: () => void }) =>
    Effect.andThen(Effect.sleep(Duration.millis(delay)), Effect.sync(late)),
  );
}

/** Whether a wait under way has stood `--luke-late-delay`; never while nothing waits. */
function useLate(waiting: boolean): boolean {
  const atom = useMemo(lateWait, []);
  const wait = useAtomSet(atom);
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!waiting) return undefined;
    const delay = lateDelay();
    if (delay <= 0) {
      setLate(true);
      return undefined;
    }
    wait({ delay, late: () => setLate(true) });
    return () => wait(Atom.Interrupt);
  }, [waiting, wait]);
  return waiting && late;
}

/**
 * The host's view as the window draws it, holding what stood while a task
 * asked for here is read. `onLand` is what turning the page does besides
 * drawing the task, such as taking down what stood in its place; it runs in
 * the same update, inside the navigation.
 */
export function useHeldOpen(view: TasksView, onLand: () => void): HeldOpen {
  const [awaited, setAwaited] = useState<string | undefined>(undefined);
  const drawn = useRef<DrawnOpen>(drawnOf(view));
  // The host turned to the task asked for, so what stood is drawn until it lands.
  const holding = awaited !== undefined && view.activeTaskId === awaited;
  // Something else turned the host meanwhile, so nothing is awaited any more.
  if (awaited !== undefined && !holding && view.activeTaskId !== drawn.current.activeTaskId) {
    setAwaited(undefined);
  }
  if (!holding) drawn.current = drawnOf(view);
  const landed = holding && documentRegion(view).kind !== DOCUMENT_REGION.READING;
  const late = useLate(holding && !landed);
  useEffect(() => {
    if (!holding) return;
    const turn = () => {
      onLand();
      setAwaited(undefined);
    };
    // Note that a read that lands turns the page as a navigation, and one late turns it at once, to its skeleton.
    if (landed) navigate(NAVIGATION.TASK_OPEN, turn);
    else if (late) turn();
  }, [holding, landed, late, onLand]);
  const shown = useMemo(() => (holding ? heldView(view, drawn.current) : view), [holding, view]);
  const release = useCallback(
    (taskId: string) => setAwaited((held) => (held === taskId ? undefined : held)),
    [],
  );
  return { view: shown, await: setAwaited, release };
}
