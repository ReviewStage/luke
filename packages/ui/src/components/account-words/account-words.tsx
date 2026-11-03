import type { ReactNode } from "react";
import { OneLine } from "../one-line/one-line.js";

/**
 * account-words.tsx -- an account's name beside its provider's, in the muted ink at the body's weight, taking the rest of the line and fading where it is cut.
 *
 * A provider and an account named in one string ("Gmail · ada@example.com")
 * read in one style, so the eye cannot find where one ends. Drawn apart,
 * the provider's name keeps its own ink and the account's stands back
 * beside it: a settings row's `adornment`, or after a server's name in a
 * popover's row. The words take a zero basis, so a long address fades on
 * the name's line rather than wrapping onto one of its own, and the hint
 * `OneLine` hangs over them reads them whole while they are cut. A list
 * row they stand in draws its chevron in its metadata's place
 * (`LIST_ROW_CHEVRON.META`), so their fade runs to the metadata rather than
 * stopping short of room kept for an unseen glyph.
 */

/** An account's name beside its provider's; `words` says them as one string where `children` draws them as a tree (a search's marks). */
export function AccountWords({
  words,
  children,
}: {
  words?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <OneLine
      className="ui-account-words min-w-0 flex-[1_1_0] font-text text-muted-foreground"
      words={words}
    >
      {children}
    </OneLine>
  );
}
