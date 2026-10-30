import { useEffect, useRef } from "react";
import { isReported, type ShownError } from "../../reported-failure.js";
import { FieldError } from "../../shadcn/field.js";
import { ANNOUNCE, type Announce, announce, type Retire } from "../announcer/announcer.js";
import { BUTTON_SIZE } from "../button/button.js";
import { FailureCopy } from "../failure-copy/failure-copy.js";

/**
 * error-line.tsx -- what went wrong, on a line of its own under what it is about: a field's value, a setting's last write, a confirm's act.
 *
 * One line says it everywhere, so a refusal reads the same in a form, a
 * Settings row, and a confirm: `FormField`, `SettingsRow`, and
 * `ConfirmDialog` each draw theirs with it. It stands from the first render,
 * empty until it says something; empty, it takes no room, so the gap before
 * it goes too. What it says is set in the caption's type in the danger ink
 * and drops into its line as it arrives, and is said through the window's
 * `Announcer` as it changes, politely unless `level` asks for an alert, as
 * a Settings row's refused write does. A control it is about names it by its
 * `id` (`aria-describedby`). It is drawn by shadcn/ui's field error
 * (`../../shadcn/field.tsx`).
 *
 * What it says is a failure of the app's, handed with the failure beneath
 * it, which is reported as it first stands and whose details it offers to
 * copy after its words, the compact copy glyph alone, named "Copy details";
 * or the person's input checked (`UNREPORTED.INPUT`), which nothing reports.
 * Only the words are said through the announcer.
 */

/** What went wrong, or nothing while nothing has. */
export function ErrorLine({
  id,
  level = ANNOUNCE.POLITE,
  error,
}: {
  /** The id a control it describes names it by. */
  id?: string | undefined;
  /** How loudly its words are said as they arrive; politely where none is named. */
  level?: Announce | undefined;
  /** What it says and the failure beneath it; nothing while nothing went wrong. */
  error?: ShownError | undefined;
}): React.JSX.Element {
  const words = useRef<HTMLSpanElement>(null);
  const said = useRef<string | undefined>(undefined);
  const taken = useRef<Retire>(() => undefined);
  // Note that the words are read off the drawn line, because a caller may
  // hand them as any node, and the words it first draws are not said, as a
  // live region's are not; words it said are taken back once the line
  // changes or goes, since what went wrong is then no longer so.
  useEffect(() => {
    const now = words.current?.textContent ?? "";
    const first = said.current === undefined;
    if (now === said.current) return;
    said.current = now;
    taken.current();
    if (!first) taken.current = announce(level, now);
  });
  useEffect(() => () => taken.current(), []);
  return (
    <FieldError id={id}>
      {error === undefined ? null : (
        <span className="luke-error-line-said flex min-w-0 items-center gap-luke-4">
          <span ref={words} className="luke-error-line-words min-w-0">
            {error.words}
          </span>
          {isReported(error.failure) ? (
            <span className="luke-error-line-copy flex flex-none">
              <FailureCopy failure={error.failure} size={BUTTON_SIZE.COMPACT} />
            </span>
          ) : null}
        </span>
      )}
    </FieldError>
  );
}
