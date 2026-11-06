import { useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTabCursor } from "@repo/features/agent-browser-tab-wire";
import { BROWSER_CURSOR_KIND } from "@repo/features/browser-agent-actions";
import { useMotionHeld } from "@repo/ui";
import { Clock, Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type CSSProperties, useMemo } from "react";
import { rendererRuntime } from "../renderer-runtime.js";

const CLOUD_BROWSER_CURSOR_IDLE = Duration.seconds(4);

const ARROW = "M1 1 13.07 5.16Q15.2 5.89 13.56 6.58L8.64 8.64 6.58 13.56Q5.89 15.2 5.16 13.07Z";

const ARROW_REACH = 16;

export interface CloudBrowserCursorFrame {
  readonly width: number;
  readonly height: number;
}

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

function idleSince(activeAt: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const left = activeAt + Duration.toMillis(CLOUD_BROWSER_CURSOR_IDLE) - now;
    if (left > 0) yield* Effect.sleep(Duration.millis(left));
  });
}

function useIdle(activeAt: number): boolean {
  const idle = useMemo(() => rendererRuntime.atom(idleSince(activeAt)), [activeAt]);
  return AsyncResult.isSuccess(useAtomValue(idle));
}

export function CloudBrowserCursor({
  cursor,
  lastActedAt,
  frame,
  hidden,
  onDarkPage,
}: {
  cursor: AgentBrowserTabCursor | undefined;
  lastActedAt: number;
  frame: CloudBrowserCursorFrame;
  hidden: boolean;
  onDarkPage: boolean;
}): React.JSX.Element | null {
  const still = useMotionHeld();
  const idle = useIdle(Math.max(lastActedAt, cursor?.at ?? 0));
  const placed = cursor === undefined ? undefined : cursorPlacement(cursor, frame);
  if (cursor === undefined || placed === undefined) return null;
  const shown = !hidden && !idle;
  const flipX = placed.x > frame.width - ARROW_REACH;
  const flipY = placed.y > frame.height - ARROW_REACH;
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
      data-flip-x={flipX ? "" : undefined}
      data-flip-y={flipY ? "" : undefined}
      data-ground={onDarkPage ? "dark" : undefined}
      style={style}
    >
      <span className="cloud-browser-cursor-halo" />
      <div className="cloud-browser-cursor-rock">
        <svg
          key={cursor.at}
          className="cloud-browser-cursor-arrow"
          viewBox="1 1 16 16"
          aria-hidden="true"
        >
          <path d={ARROW} />
        </svg>
      </div>
      {cursor.kind === BROWSER_CURSOR_KIND.CLICK && shown && !still ? (
        <span key={cursor.at} className="cloud-browser-cursor-ripple" />
      ) : null}
    </div>
  );
}
