import { type ButtonHTMLAttributes, type ReactNode, useCallback, useState } from "react";
import { Spinner } from "./spinner";
import { Tooltip } from "./tooltip";

/**
 * folding-button.tsx -- a toolbar's labelled button whose words a narrow toolbar folds away, leaving its glyph, named by the pill.
 *
 * A toolbar too narrow for every act's words hides them by a container query
 * of its own (`.toolbar-button-words`, which only that query hides), so its
 * acts keep their places as glyphs rather than crowding the title beside
 * them off its line or drawing over it. Folded, the button is named by its
 * words for a reader and raises them in the window's pill for the pointer;
 * drawn, its words name it and it raises nothing, since a pill repeating
 * the words beside it says nothing.
 */

/** The class of the words a toolbar's container query may fold away. */
const WORDS = "toolbar-button-words";

/**
 * Whether the button's words are folded away, read whenever the button's
 * box changes, which folding them does. Note that the button is observed
 * rather than its words, because words folded from the first frame report
 * no change of size to observe.
 */
function useFolded(): [(button: HTMLElement | null) => (() => void) | undefined, boolean] {
  const [folded, setFolded] = useState(false);
  const measured = useCallback((button: HTMLElement | null) => {
    if (button === null) return undefined;
    const words = button.querySelector(`.${WORDS}`);
    const observer = new ResizeObserver(() =>
      setFolded(words !== null && getComputedStyle(words).display === "none"),
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, []);
  return [measured, folded];
}

/** A labelled toolbar button, its glyph then its words, the words folding away where its toolbar says so. */
export function FoldingButton({
  label,
  glyph,
  busy,
  children,
  className = "toolbar-button",
  ...button
}: {
  /** Its words, and its name and pill once they are folded away. */
  label: string;
  glyph: ReactNode;
  /** While its press is out, what it is doing ("Running"): folded, the ring stands in its glyph's place under that name, since the words that carry the ring are gone. */
  busy?: string | undefined;
  /** What stands for the words while they are drawn, where that is more than the words: a busy ring over them. */
  children?: ReactNode;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "type"
>): React.JSX.Element {
  const [measured, folded] = useFolded();
  const ringed = folded && busy !== undefined;
  return (
    <Tooltip label={folded ? label : undefined}>
      <button
        ref={measured}
        type="button"
        className={className}
        aria-label={folded ? label : undefined}
        {...button}
      >
        {ringed ? <Spinner label={busy} /> : glyph}
        <span className={WORDS}>{children ?? label}</span>
      </button>
    </Tooltip>
  );
}
