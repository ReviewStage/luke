/**
 * toolbar-name.tsx -- the page's own name as a bar draws it, its trail before it as crumbs, which `Toolbar` heads itself with and the window's title bar names a place by (`FramePlace`).
 *
 * A part of those two, drawn in each one's catalog examples, so it stands
 * behind no door of the package's own.
 */

import type { ReactNode } from "react";
import { BREADCRUMBS_VARIANT, Breadcrumbs, type Crumb } from "../breadcrumbs/breadcrumbs.js";
import { ONE_LINE_ELEMENT, OneLine } from "../one-line/one-line.js";
import { wholeWordsHint } from "../tooltip/hint.js";
import type { ToolbarPickUp, ToolbarPlace, ToolbarProps } from "./toolbar.js";

/** The name of a trail's landmark. */
const TRAIL_LABEL = "Path";

/** The title, in the dialog's type with a title's tracking; its room reaches 6px left of the words, so its own hover fill and field ring, which start there, are not clipped. */
const TITLE =
  "luke-toolbar-title m-0 -ml-luke-6 pl-luke-6 text-dialog-size font-dialog tracking-title";

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
export function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The page's name as the bar's heading: words on one line, fading where cut and read whole by the hint; anything else as given. */
function ToolbarTitle({ title }: { title: ReactNode }): React.JSX.Element {
  if (typeof title !== "string") return <>{title}</>;
  return (
    <OneLine as={ONE_LINE_ELEMENT.H1} hint={wholeWordsHint(title)} className={TITLE}>
      {title}
    </OneLine>
  );
}

/** A place of the trail as a crumb: the folding way back where it wears a glyph, a quiet pill where it does not. */
function placeCrumb(place: ToolbarPlace): Crumb {
  const onPress = () => place.onPress();
  return place.icon === undefined
    ? { label: place.label, onPress }
    : { label: place.label, icon: place.icon, onPress };
}

/**
 * The page's trail: the places above it, then its own name last, words that
 * are no press, said to be the current page. A name that comes and goes
 * (`shown`, as a document's does once its header has scrolled away) joins
 * the trail fading in, and is out of it, and a reader's, while it is gone.
 */
function ToolbarTrail({
  trail,
  title,
  shown,
}: {
  trail: readonly ToolbarPlace[];
  title: string;
  shown?: boolean | undefined;
}): React.JSX.Element {
  // Note that a name not yet read leaves the places alone, so the way back stands while it loads.
  const own: Crumb[] = title === "" ? [] : [{ label: title, current: true, shown }];
  return (
    <Breadcrumbs
      label={TRAIL_LABEL}
      variant={BREADCRUMBS_VARIANT.TITLE}
      crumbs={[...trail.map(placeCrumb), ...own]}
    />
  );
}

/** The name the bar picks up from a document's header: words on one line, there to fade in and out, hidden from a reader until shown. */
function ToolbarPickedUp({ pickUp }: { pickUp: ToolbarPickUp }): React.JSX.Element {
  return (
    <span
      className="luke-toolbar-pick-up"
      data-shown={pickUp.shown ? "true" : "false"}
      aria-hidden={pickUp.shown ? undefined : "true"}
    >
      <OneLine hint={pickUp.shown ? wholeWordsHint(pickUp.name) : undefined} className={TITLE}>
        {pickUp.name}
      </OneLine>
    </span>
  );
}

/**
 * The page's own name as a bar draws it: crumbs after its trail where it has
 * one, else its title, else the name picked up from its header; nothing
 * where none is said. The window's title bar names a place the same way
 * (`FramePlace`).
 */
export function ToolbarName({
  title,
  trail,
  pickUp,
}: Pick<ToolbarProps, "title" | "trail" | "pickUp">): React.JSX.Element | null {
  if (trail !== undefined && trail.length > 0 && typeof title === "string" && title !== "") {
    return <ToolbarTrail trail={trail} title={title} />;
  }
  if (trail !== undefined && trail.length > 0 && !said(title) && pickUp !== undefined) {
    return <ToolbarTrail trail={trail} title={pickUp.name} shown={pickUp.shown} />;
  }
  if (said(title)) return <ToolbarTitle title={title} />;
  if (pickUp !== undefined && pickUp.name !== "") return <ToolbarPickedUp pickUp={pickUp} />;
  return null;
}
