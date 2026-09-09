/**
 * The small mark beside a row's name while its value differs from the
 * default: what a page's reset would change, said row by row rather than
 * only by the reset appearing. A statement, not a control — the row's own
 * control is where the value moves — so it carries its meaning as words for
 * a reader and a hover alike.
 */
export function ChangedMark(): React.JSX.Element {
  return (
    <span className="settings-changed" title="Changed from its default">
      <span className="visually-hidden">(changed from its default)</span>
    </span>
  );
}

/**
 * The small mark beside a name while the feature it belongs to still needs a
 * hand — the same mark wherever it stands, so one urgency reads the same on
 * the front page's Voice row, on the row that supplies the missing thing, and
 * on a shortcut whose key answers nothing until it is supplied. A statement,
 * not a control: the words are the hover's and the screen reader's, and the
 * page around it is where the missing thing is explained.
 */
export function AttentionMark({ note }: { note: string }): React.JSX.Element {
  return (
    <span className="settings-attention" title={note}>
      <span aria-hidden="true">!</span>
      <span className="visually-hidden">({note})</span>
    </span>
  );
}

/* Whether each group holds a value its reset would change, judged from the
   same resolved settings the rows draw — so the mark, the reset, and the row
   always agree on what is standing. The voice and pace compare against the
   shipped defaults the way their menus label them; a launch-environment
   override reads as changed, which is what the row shows too. */
