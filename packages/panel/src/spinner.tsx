/**
 * spinner.tsx -- the window's waits, drawn with `@luke/ui`'s shared spinner, shown once they have stood a moment.
 *
 * The ring, its sizes, and how a control's words give way to it are the
 * shared spinner's. What is the window's own is when a wait starts showing:
 * only once it has stood for `SHOW_DELAY`, timed on the renderer's runtime,
 * because a ring that flashes for a read that landed at once is noise. Each
 * mount waits afresh. An agent at work is not a wait and wears the working
 * mark instead (`working-mark.tsx`).
 */

import { useAtomValue } from "@effect/atom-react";
import {
  BusyLabel as SharedBusyLabel,
  Spinner as SharedSpinner,
  SpinnerRegion as SharedSpinnerRegion,
  SPINNER_SIZE,
  type SpinnerSize,
} from "@luke/ui";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, useState } from "react";
import { rendererRuntime } from "./renderer-runtime.js";

export { SPINNER_SIZE, SpinnerRing, type SpinnerSize } from "@luke/ui";

/** How long a wait stands before its ring shows: past a read that lands at once, short of a wait anyone notices. */
const SHOW_DELAY = Duration.millis(180);

/** Whether the wait mounted with this hook has stood long enough to show; each mount waits afresh. */
function useWaitShown(): boolean {
  const [wait] = useState(() => rendererRuntime.atom(Effect.sleep(SHOW_DELAY)));
  return AsyncResult.isSuccess(useAtomValue(wait));
}

/** A wait, said to a reader in `label` and drawn as the ring once it has stood a moment. */
export function Spinner({
  label,
  size = SPINNER_SIZE.INLINE,
}: {
  label: string;
  size?: SpinnerSize;
}): React.JSX.Element {
  return <SharedSpinner label={label} size={size} shown={useWaitShown()} />;
}

/** A region still being read: the ring at the region's size, centred in the room it fills, once it has stood a moment. */
export function SpinnerRegion({ label }: { label: string }): React.JSX.Element {
  return <SharedSpinnerRegion label={label} shown={useWaitShown()} />;
}

/** A busy control's words under the ring, the wait timed from when the press went out. */
function BusyWords({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <SharedBusyLabel busy label={label} shown={useWaitShown()}>
      {children}
    </SharedBusyLabel>
  );
}

/** A button's words, which give way to the ring once its press has been out a moment, `label` naming it to a reader. */
export function BusyLabel({
  busy,
  label,
  children,
}: {
  busy: boolean;
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return busy ? <BusyWords label={label}>{children}</BusyWords> : <>{children}</>;
}
