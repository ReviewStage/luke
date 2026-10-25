import type { ReactNode } from "react";

/**
 * tab-notice.tsx -- one quiet line standing under a tab's bar, over what the tab shows, across its whole width.
 *
 * A tab says here what the reader must know before reading what it shows:
 * why the file is not drawn, over the lines that were shown of it; that a
 * filter narrows the list under it, with the press that clears it; that
 * chapters were made for an older head, with Regenerate; that a long list
 * leaves files out. The words are a paragraph that takes the line, and what
 * may be done about them stands at its end, a control's gap after them, in
 * the caption role and the muted ink, ruled off from what stands under it.
 * Inside a code card, whose own frame closes it, it draws no rule of its own.
 */

/** `children`, a paragraph and the presses after it, as the line under a tab's bar. */
export function TabNotice({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="luke-tab-notice flex items-center gap-control-gap border-b border-border px-list-inset py-row-inset text-caption text-muted-foreground [.luke-code-card>&]:border-b-0 [&>p]:m-0 [&>p]:flex-1">
      {children}
    </div>
  );
}
