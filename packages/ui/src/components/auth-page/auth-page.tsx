import { type MouseEvent, type ReactNode, useId } from "react";
import { BUTTON_VARIANT, ButtonLink } from "../button/button.js";

/**
 * auth-page.tsx -- the page a sign-in, a consent, or a connection is drawn on: one card, centred in the window, with nothing else on the page.
 *
 * The card holds, one under another, the artwork it opens with, its title,
 * what the title means, the form or the provider choices the page is for,
 * what went wrong, the one way on it offers, and a closing note. The page
 * owns every length between them and the card's own width, which gives way
 * to a narrow window rather than overflowing it: its inset narrows under a
 * phone's width, and what it holds stretches to the card's inner width, so a
 * provider's button or a form's field is never wider than the screen. The way
 * on is a link drawn as an outline button, centred under the words. A caller
 * hands it words and controls, never a class.
 *
 * The artwork is decoration, hidden from a reader, since the title says what
 * the card is and how it stands. The error stands in an alert region from the
 * first render, empty until it says something, because a reader announces a
 * region filling more surely than one arriving.
 */

/** The one way on a page offers: its words, where it goes, and what its press does first. */
export interface AuthAction {
  readonly label: string;
  readonly href: string;
  readonly onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
}

/** Whether words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A sign-in, consent, or connection page: `title` under `mark`, holding `children`, with `action` under them. */
export function AuthPage({
  mark,
  title,
  description,
  error,
  action,
  footnote,
  children,
}: {
  /** The artwork the page opens with: an `AuthMark`, or Luke's face. */
  mark?: ReactNode;
  /** What the page is for, or how it ended, which names it. */
  title: ReactNode;
  description?: ReactNode;
  /** What went wrong, or nothing while nothing has. */
  error?: ReactNode;
  /** The way on, such as Open Luke, or nothing where there is none. */
  action?: AuthAction | undefined;
  /** A closing note under everything else ("You can close this window"). */
  footnote?: ReactNode;
  /** The form or the provider choices, each stretched to the card's width. */
  children?: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  return (
    <main className="luke-auth-page">
      <section className="luke-auth-card" aria-labelledby={titleId}>
        {said(mark) ? (
          <div className="luke-auth-mark" aria-hidden="true">
            {mark}
          </div>
        ) : null}
        <h1 className="luke-auth-title" id={titleId}>
          {title}
        </h1>
        {said(description) ? <p className="luke-auth-description">{description}</p> : null}
        {said(children) ? <div className="luke-auth-body">{children}</div> : null}
        <p className="luke-auth-error" role="alert">
          {said(error) ? error : null}
        </p>
        {action === undefined ? null : (
          <div className="luke-auth-action">
            <ButtonLink
              href={action.href}
              variant={BUTTON_VARIANT.OUTLINE}
              onClick={action.onClick}
            >
              {action.label}
            </ButtonLink>
          </div>
        )}
        {said(footnote) ? <p className="luke-auth-footnote">{footnote}</p> : null}
      </section>
    </main>
  );
}
