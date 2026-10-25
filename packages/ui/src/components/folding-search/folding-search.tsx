import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SearchIcon } from "../../face/glyphs.js";
import { useDisclosure } from "../../use-disclosure.js";
import { IconButton } from "../button/button.js";
import { SearchField } from "../search-field/search-field.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * folding-search.tsx -- a name and a magnifier after it, which a press unfolds into a search laid over them both.
 *
 * For a head too tight for a search of its own, as the sidebar's sections
 * are. The name and the magnifier share one box, and the field is laid over
 * that box rather than in its place, so nothing after it moves as the field
 * opens or folds: a control beside it stays under the pointer on its way
 * there, and a press on one lands though the press folded the field.
 *
 * Opening, the field unfolds out of the magnifier's own shape, its glyph
 * riding the leading edge from where the button's stood, and its words
 * follow once the well is open; the name and the magnifier fade under it,
 * out of reach. The field narrows its caller's list as it is typed in and
 * stands open while it holds words. Escape empties and folds it, handing the
 * keyboard back to the magnifier, and the focus leaving it empty folds it
 * too. Folding plays the way back, the field held through its exit
 * (`useDisclosure`) and out of reach while it leaves, and the name fades in
 * once it is gone.
 */

/** The box the name and its magnifier share, which the field is laid over while open. */
const BOX =
  "luke-folding-search group/fold relative flex min-w-0 flex-1 items-center gap-control-gap";

/**
 * What the field covers fades back once the field has left, waiting out its
 * exit, and fades out at once as it arrives.
 */
const COVERED =
  "flex transition-opacity duration-(--luke-duration-quick) ease-pane not-group-data-[open=true]/fold:delay-(--luke-duration-exit) group-data-[open=true]/fold:opacity-0 group-data-[open=true]/fold:duration-(--luke-duration-exit) group-data-[open=true]/fold:ease-plain";

/** The search, laid over the whole box; its unfolding and folding stay in `folding-search.css`. */
const FIELD =
  "luke-folding-search-field absolute inset-0 flex items-center [&>.luke-search-field]:w-full";

/** A name the field covers, and the search a press on its magnifier unfolds over it, named `label`. */
export function FoldingSearch({
  label,
  value,
  onChange,
  children,
}: {
  /** The search's name, on its magnifier, its field, and its placeholder alike. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The name the field covers while it is open. */
  children: ReactNode;
}): React.JSX.Element {
  const [asked, setAsked] = useState(false);
  const open = asked || value !== "";
  const field = useDisclosure(open);
  const well = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const magnifier = useRef<HTMLButtonElement | null>(null);
  const backToMagnifier = useRef(false);
  // Note that the glyph's travel is measured before the first frame, so it starts exactly on the button's.
  useLayoutEffect(() => {
    const box = well.current;
    const from = magnifier.current?.querySelector("svg");
    const to = box?.querySelector(".luke-search-field > svg");
    if (!field.mounted || field.leaving || box === null || box === undefined) return;
    if (from === null || from === undefined || to === null || to === undefined) return;
    const travel = from.getBoundingClientRect().left - to.getBoundingClientRect().left;
    box.style.setProperty("--luke-folding-search-travel", `${travel}px`);
  }, [field.mounted, field.leaving]);
  useEffect(() => {
    if (open) {
      input.current?.focus();
      return;
    }
    if (!backToMagnifier.current) return;
    backToMagnifier.current = false;
    magnifier.current?.focus();
  }, [open]);
  const fold = (handBack: boolean) => {
    backToMagnifier.current = handBack;
    onChange("");
    setAsked(false);
  };
  return (
    <div className={BOX} data-open={open ? "true" : undefined}>
      <div
        className={`luke-folding-search-name min-w-0 flex-1 items-center [&>*]:min-w-0 [&>*]:flex-1 ${COVERED}`}
        inert={open}
      >
        {children}
      </div>
      <span className={`luke-folding-search-magnifier ${COVERED}`} inert={open}>
        <Tooltip label={label}>
          <IconButton
            ref={magnifier}
            icon={<SearchIcon />}
            label={label}
            onClick={() => setAsked(true)}
          />
        </Tooltip>
      </span>
      {field.mounted ? (
        <search
          ref={(element) => {
            well.current = element;
            field.ref(element);
          }}
          className={FIELD}
          data-leaving={field.leaving ? "true" : undefined}
          inert={field.leaving}
          onBlur={(event) => {
            // Note that a press on the field's own clear moves the focus within it, which folds nothing.
            if (event.currentTarget.contains(event.relatedTarget)) return;
            if (value === "") fold(false);
          }}
        >
          <SearchField
            ref={input}
            label={label}
            placeholder={label}
            value={value}
            onChange={onChange}
            onClear={() => onChange("")}
            onEscape={() => fold(true)}
          />
        </search>
      ) : null}
    </div>
  );
}
