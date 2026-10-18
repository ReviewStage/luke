import { type ReactNode, useId } from "react";

/**
 * auth-page.tsx -- the page a sign-in, a consent, or a connection is drawn on: one card, centred in the window, with nothing else on the page.
 *
 * The card holds, one under another, the artwork it opens with, a word on
 * where things stand, its title, what the title means, the form or the
 * provider choices the page is for, what went wrong, and a closing note. The
 * page owns every length between them and the card's own width, which gives
 * way to a narrow window rather than overflowing it: its inset narrows under
 * a phone's width, and what it holds stretches to the card's inner width, so
 * a provider's button or a form's field is never wider than the screen. A
 * caller hands it words and controls, never a class.
 *
 * The artwork is decoration, hidden from a reader, since the title says what
 * the page is. The error stands in an alert region from the first render,
 * empty until it says something, because a reader announces a region filling
 * more surely than one arriving.
 */

/** Where things stand, which the status word is drawn in: settled while the flow is on its way, attention once it is not. */
export const AUTH_STATUS_TONE = {
  SETTLED: "settled",
  ATTENTION: "attention",
} as const;

export type AuthStatusTone = (typeof AUTH_STATUS_TONE)[keyof typeof AUTH_STATUS_TONE];

/** A short word on where the flow stands ("Confirming", "Not completed"), and its tone. */
export interface AuthStatus {
  readonly tone: AuthStatusTone;
  readonly label: string;
}

/** Whether words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A sign-in, consent, or connection page: `title` on one card under `mark`, holding `children`. */
export function AuthPage({
  mark,
  status,
  title,
  description,
  error,
  footnote,
  children,
}: {
  /** The artwork the card opens with: Luke's mark, or a provider's joined to it. */
  mark?: ReactNode;
  status?: AuthStatus | undefined;
  /** What the page is for, which names the card. */
  title: ReactNode;
  description?: ReactNode;
  /** What went wrong, or nothing while nothing has. */
  error?: ReactNode;
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
        {status ? (
          <p className="luke-auth-status" data-tone={status.tone}>
            {status.label}
          </p>
        ) : null}
        <h1 className="luke-auth-title" id={titleId}>
          {title}
        </h1>
        {said(description) ? <p className="luke-auth-description">{description}</p> : null}
        {said(children) ? <div className="luke-auth-body">{children}</div> : null}
        <p className="luke-auth-error" role="alert">
          {said(error) ? error : null}
        </p>
        {said(footnote) ? <p className="luke-auth-footnote">{footnote}</p> : null}
      </section>
    </main>
  );
}
