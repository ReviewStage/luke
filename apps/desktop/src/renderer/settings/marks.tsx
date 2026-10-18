import { AlertIcon } from "@luke/ui";

/**
 * The word beside a row's name while its value differs from the default,
 * as VS Code's settings editor says it: what a page's reset would change,
 * said row by row rather than only by the reset appearing. A statement, not
 * a control — the row's own control is where the value moves — and a word
 * rather than a dot, so a reader and a glance read the same thing.
 */
export function ChangedMark(): React.JSX.Element {
  return <span className="settings-changed">Modified</span>;
}

/**
 * The small mark beside a name while the feature it belongs to still needs a
 * hand — the same mark wherever it stands, so one urgency reads the same on
 * the Settings sidebar's Voice row, on the row that supplies the missing thing, and
 * on a shortcut whose key answers nothing until it is supplied. It is
 * `@luke/ui`'s alert glyph in the attention ink. A statement, not a control:
 * the words are the hover's and the screen reader's, and the page around it
 * is where the missing thing is explained.
 */
export function AttentionMark({ note }: { note: string }): React.JSX.Element {
  return (
    <span className="settings-attention" title={note}>
      <AlertIcon />
      <span className="visually-hidden">({note})</span>
    </span>
  );
}

/* Whether each group holds a value its reset would change, judged from the
   same resolved settings the rows draw — so the mark, the reset, and the row
   always agree on what is standing. The voice and pace compare against the
   shipped defaults the way their menus label them; a launch-environment
   override reads as changed, which is what the row shows too. */
