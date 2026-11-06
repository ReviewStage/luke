/**
 * error-boundary.tsx -- a place whose drawing failed says so, with Reload, rather than leaving the window blank.
 *
 * A render that throws, or a chunk of code that could not be read, takes
 * down everything up to the nearest boundary above it, and with none, the
 * whole window, which React then leaves empty. So every window's root and
 * every surface drawn on demand (`@repo/panel`'s `lazyRoute`) stands under
 * one of these: what failed beneath it is replaced by `ReloadState`, and the
 * rest of the window keeps going. Reload runs `onReload` where one is given,
 * the window's own reload at a root or a route's forgetting of its failed
 * chunk, and then draws the place again.
 *
 * A window whose first read failed has no surface to stand a boundary
 * over, so it draws what a boundary would have, `ReloadState`, alone.
 *
 * `ReloadState` is the product's own, laid out as a crash screen in a
 * polished desktop tool is: the product's mark in the ring an auth page opens
 * with, badged with the failure's cross; "Something went wrong" as the
 * place's heading; the place's own sentence and the promise that a reload
 * usually mends it in the muted ink under it; Reload as its one primary
 * press, with the chord that does the same; and, under it, what was thrown,
 * in the code face in a well, which a person can select and send with a
 * report. A place that failed to draw is most often mended by the next
 * draw, so the words stay calm and the red is the badge's alone.
 *
 * It stands centered in the room it fills, a little above the middle where
 * the eye takes the middle to be, as an empty state does (`EmptyState`). A
 * window's root is no flex column to stretch it, so where it stands for the
 * whole window (`RELOAD_ROOM.WINDOW`) it covers the window by itself, on the
 * window's ground, with a strip across its top a desktop window is dragged
 * by, since no title bar stands over it; in a region of the window it fills
 * that region as an empty state does, and the sheets that place an empty
 * state place it too (`ui-empty-state`).
 *
 * Note that it reports nothing itself, because the root it stands in hears
 * every error a boundary caught (`createRoot`'s `onCaughtError`), the one
 * place that knows where a window reports to. Note too that it is a door of
 * its own (`@repo/ui/error-boundary`), outside the barrel, because every
 * window's root draws it, which would otherwise parse the whole barrel on its
 * way to its first paint.
 */

import { LANDING_TONE } from "@repo/features/landing-outcome";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import { Component, type ReactNode } from "react";
import { RetryIcon } from "../../icons/lucide-glyphs.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { AuthMark } from "../auth-page/auth-mark.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/** What a place whose drawing failed says where its caller names nothing more fitting. */
const SHOWN_FAILED = "This page could not be shown.";

/** The words every failed place says around its own sentence. */
const WORDS = {
  HEADING: "Something went wrong",
  MENDS: "Reloading usually fixes it.",
  RELOAD: "Reload",
} as const;

/** The room a failed place fills: the whole window, at a root, or a region of it, at a route. */
export const RELOAD_ROOM = {
  WINDOW: "window",
  REGION: "region",
} as const;

export type ReloadRoom = (typeof RELOAD_ROOM)[keyof typeof RELOAD_ROOM];

/**
 * Each room's box. Note that both share their space above and below the
 * block two to three, as `EmptyState`'s room does, and scroll rather than
 * overflow where the room is shorter than the block; the window's covers
 * the window whatever its parent is, on the window's own ground.
 */
const ROOM = {
  [RELOAD_ROOM.WINDOW]:
    "ui-reload-state fixed inset-0 flex flex-col items-center overflow-x-hidden overflow-y-auto bg-ground before:flex-[2_1_0] after:flex-[3_1_0]",
  [RELOAD_ROOM.REGION]:
    "ui-reload-state ui-empty-state flex min-h-0 flex-[1_1_0] flex-col items-center overflow-x-hidden overflow-y-auto before:flex-[2_1_0] after:flex-[3_1_0]",
} as const satisfies Record<ReloadRoom, string>;

/** The heading's element: the window's one heading, or a region's under the window's own. */
const HEADING_ELEMENT = {
  [RELOAD_ROOM.WINDOW]: TEXT_ELEMENT.H1,
  [RELOAD_ROOM.REGION]: TEXT_ELEMENT.H2,
} as const satisfies Record<ReloadRoom, (typeof TEXT_ELEMENT)[keyof typeof TEXT_ELEMENT]>;

/**
 * What was thrown, as one line a person can send: an error's name and
 * message, or the thrown value said as words; nothing where nothing was
 * handed. Note that a value that cannot be said as words (one with no
 * prototype, or a getter that throws) answers nothing too, because a throw
 * here would take down the very screen that says the place failed.
 */
function thrownWords(thrown: unknown): string | undefined {
  if (thrown === undefined) return undefined;
  try {
    if (thrown instanceof Error) {
      return thrown.message === "" ? String(thrown.name) : `${thrown.name}: ${thrown.message}`;
    }
    return String(thrown);
  } catch {
    return undefined;
  }
}

/**
 * What a place whose drawing failed stands in its stead: the badged mark
 * over the heading, `failure` or the boundary's own sentence, and Reload,
 * whose press is `onReload`, as one alert, with what was thrown under it
 * where `error` is handed, filling `room`.
 */
export function ReloadState({
  failure = SHOWN_FAILED,
  error,
  room = RELOAD_ROOM.REGION,
  onReload,
}: {
  failure?: string | undefined;
  /** What was thrown, shown in the code face under Reload; nothing where none is handed. */
  error?: unknown;
  /** The room it fills; a region of the window where none is named. */
  room?: ReloadRoom | undefined;
  onReload: () => void;
}): React.JSX.Element {
  const thrown = thrownWords(error);
  return (
    <div className={ROOM[room]} data-room={room}>
      {room === RELOAD_ROOM.WINDOW ? (
        <div
          className="ui-reload-state-drag absolute inset-x-0 top-0 h-ui-40 in-data-[ui-profile=desktop]:[-webkit-app-region:drag]"
          aria-hidden="true"
        />
      ) : null}
      <div className="ui-reload-state-body box-border flex w-full max-w-auth-card flex-col items-center p-ui-24 text-center">
        <div role="alert" className="flex flex-col items-center">
          <span className="ui-reload-state-mark inline-flex" aria-hidden="true">
            <AuthMark tone={LANDING_TONE.DANGER} />
          </span>
          <Text
            as={HEADING_ELEMENT[room]}
            variant={TEXT_VARIANT.DIALOG}
            className="mt-ui-20 text-balance"
          >
            <ReplayWords unmasked>{WORDS.HEADING}</ReplayWords>
          </Text>
          <Text tone={TEXT_TONE.MUTED} className="mt-ui-8 text-balance">
            <ReplayWords unmasked>{`${failure} ${WORDS.MENDS}`}</ReplayWords>
          </Text>
          <div className="ui-reload-state-action mt-ui-24 in-data-[ui-profile=desktop]:[-webkit-app-region:no-drag]">
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              icon={<RetryIcon />}
              turns
              trailing={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.RELOAD].chord} />}
              onClick={onReload}
            >
              <ReplayWords unmasked>{WORDS.RELOAD}</ReplayWords>
            </Button>
          </div>
        </div>
        {thrown === undefined ? null : (
          <div className="ui-reload-state-thrown mt-ui-32 box-border w-full max-w-full rounded-control bg-well px-ui-12 py-ui-8 text-start">
            <Text
              variant={TEXT_VARIANT.CAPTION}
              font={TEXT_FONT.MONO}
              tone={TEXT_TONE.MUTED}
              className="line-clamp-3"
            >
              {thrown}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  /** What failed, as "This window could not be shown." */
  readonly failure?: string | undefined;
  /** The room its failure fills; a region of the window where none is named. */
  readonly room?: ReloadRoom | undefined;
  /** What Reload does before the place is drawn again; nothing more where none is given. */
  readonly onReload?: (() => void) | undefined;
  readonly children?: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
  /** What its children threw, shown under Reload. */
  readonly error?: unknown;
}

/**
 * Draws `children`, or, once one of them has thrown while drawing, the
 * centered `failure` with Reload, which runs `onReload` and draws them again.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { failed: true, error };
  }

  reload = (): void => {
    this.props.onReload?.();
    this.setState({ failed: false, error: undefined });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <ReloadState
        failure={this.props.failure}
        error={this.state.error}
        room={this.props.room}
        onReload={this.reload}
      />
    );
  }
}
