import { useEffect, useRef } from "react";
import { isReported, type ShownError } from "../../reported-failure.js";
import { FieldError } from "../../shadcn/field.js";
import { useDisclosure } from "../../use-disclosure.js";
import { ANNOUNCE, type Announce, announce, type Retire } from "../announcer/announcer.js";
import { BUTTON_SIZE } from "../button/button.js";
import { FailureCopy } from "../failure-copy/failure-copy.js";

export function ErrorLine({
  id,
  level = ANNOUNCE.POLITE,
  error,
}: {
  id?: string | undefined;
  level?: Announce | undefined;
  error?: ShownError | undefined;
}): React.JSX.Element {
  const words = useRef<HTMLSpanElement>(null);
  const said = useRef<string | undefined>(undefined);
  const taken = useRef<Retire>(() => undefined);
  useEffect(() => {
    const now = words.current?.textContent ?? "";
    const first = said.current === undefined;
    if (now === said.current) return;
    said.current = now;
    taken.current();
    if (!first) taken.current = announce(level, now);
  });
  useEffect(() => () => taken.current(), []);
  const shown = useDisclosure(error !== undefined);
  const last = useRef(error);
  if (error !== undefined) last.current = error;
  const drawn = shown.mounted ? (error ?? last.current) : undefined;
  return (
    <FieldError
      id={id}
      ref={shown.ref}
      data-leaving={shown.leaving ? "true" : undefined}
      inert={shown.leaving}
    >
      {drawn === undefined ? null : (
        <span className="ui-error-line-said flex min-w-0 items-center gap-ui-4">
          <span ref={words} className="ui-error-line-words min-w-0">
            {drawn.words}
          </span>
          {isReported(drawn.failure) ? (
            <span className="ui-error-line-copy flex flex-none">
              <FailureCopy failure={drawn.failure} size={BUTTON_SIZE.COMPACT} />
            </span>
          ) : null}
        </span>
      )}
    </FieldError>
  );
}
