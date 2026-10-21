/**
 * cloud-browser-cursor.tsx -- the agent's pointer over a cloud Browser tab's live view: an arrow the panel draws over the page, never in it, gliding to each point the agent clicks or types at.
 *
 * The agent's actions report each point a beat before their input lands
 * (`@luke/features/browser-agent-cdp`'s `BROWSER_CURSOR_BEAT`), in the page's
 * CSS pixels of its visible area, and the tab's live read carries the last
 * one (`AgentBrowserTab.cursor`). The arrow stands at that point scaled onto
 * the drawn page, and glides there over `--duration-fast` on
 * `--spring-fast`, about the beat, so it arrives as the action lands. While
 * the agent is active on the tab it rocks gently about its tip, a loop
 * `--loop-motion` holds still; a click presses it, with a soft ripple at
 * the point, and typing bobs it. It fades once the agent has done nothing
 * for `CLOUD_BROWSER_CURSOR_IDLE`, timed on the renderer's runtime, and back
 * in on its next move. It is hidden while a member drives the tab, since the
 * pointer is theirs then. Reduced motion holds it still: no rock, no bob,
 * no press, and a move jumps.
 *
 * The arrow takes no pointer events, is no part of the frame the canvas
 * draws, and is left out of the screen recording (`ph-no-capture`); a point
 * and a kind are no page content.
 */

import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTabCursor } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_CURSOR_KIND } from "@luke/features/browser-agent-actions";
import { Clock, Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type CSSProperties, useMemo } from "react";
import { rendererRuntime } from "../renderer-runtime.js";
import { usePrefersReducedMotion } from "../use-reduced-motion.js";

/** How long after the agent last acted on the tab its pointer stands; past it the pointer fades. */
export const CLOUD_BROWSER_CURSOR_IDLE = Duration.seconds(4);

/** The drawn page's size in CSS pixels of the panel. */
export interface CloudBrowserCursorFrame {
  readonly width: number;
  readonly height: number;
}

/** Where the pointer stands on the drawn page: its point scaled from the page's visible area onto the frame; none where either has no size. */
export function cursorPlacement(
  cursor: AgentBrowserTabCursor,
  frame: CloudBrowserCursorFrame,
): { readonly x: number; readonly y: number } | undefined {
  const { width, height } = cursor.viewport;
  if (width < 1 || height < 1 || frame.width < 1 || frame.height < 1) return undefined;
  const clamp = (value: number, most: number) => Math.max(0, Math.min(most, value));
  return {
    x: clamp((cursor.x / width) * frame.width, frame.width),
    y: clamp((cursor.y / height) * frame.height, frame.height),
  };
}

/** Settles once the agent has stood idle past the bound since `activeAt`, at once where it already has. */
function idleSince(activeAt: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const left = activeAt + Duration.toMillis(CLOUD_BROWSER_CURSOR_IDLE) - now;
    if (left > 0) yield* Effect.sleep(Duration.millis(left));
  });
}

/** Whether the agent has stood idle on the tab past the bound since `activeAt`, in epoch milliseconds. */
function useIdle(activeAt: number): boolean {
  const idle = useMemo(() => rendererRuntime.atom(idleSince(activeAt)), [activeAt]);
  return AsyncResult.isSuccess(useAtomValue(idle));
}

/** The agent's pointer, drawn over the page, hidden where `hidden`: while a member drives the tab, or no page stands. */
export function CloudBrowserCursor({
  cursor,
  lastActedAt,
  frame,
  hidden,
}: {
  cursor: AgentBrowserTabCursor | undefined;
  /** Epoch milliseconds the agent last acted on the tab. */
  lastActedAt: number;
  frame: CloudBrowserCursorFrame;
  hidden: boolean;
}): React.JSX.Element | null {
  const still = usePrefersReducedMotion();
  const idle = useIdle(Math.max(lastActedAt, cursor?.at ?? 0));
  const placed = cursor === undefined ? undefined : cursorPlacement(cursor, frame);
  if (cursor === undefined || placed === undefined) return null;
  const shown = !hidden && !idle;
  const style = {
    "--cloud-browser-cursor-x": `${placed.x}px`,
    "--cloud-browser-cursor-y": `${placed.y}px`,
  } as CSSProperties;
  return (
    <div
      className="cloud-browser-cursor ph-no-capture"
      aria-hidden="true"
      data-shown={shown ? "" : undefined}
      data-still={still ? "" : undefined}
      data-kind={cursor.kind}
      style={style}
    >
      <div className="cloud-browser-cursor-rock">
        {/* Keyed by the move, so each click presses afresh. */}
        <svg
          key={cursor.at}
          className="cloud-browser-cursor-arrow"
          viewBox="1.5 1.5 20 20"
          aria-hidden="true"
        >
          <path d="M1.5 1.5v15.2l4.1-3.7 2.9 6.1 2.7-1.3-2.9-6h5.6z" />
        </svg>
      </div>
      {cursor.kind === BROWSER_CURSOR_KIND.CLICK && shown && !still ? (
        <span key={cursor.at} className="cloud-browser-cursor-ripple" />
      ) : null}
    </div>
  );
}
