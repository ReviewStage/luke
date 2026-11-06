import { Children, type MouseEvent, type ReactNode, useId } from "react";
import { isReported, type ShownError } from "../../reported-failure.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, ButtonLink } from "../button/button.js";
import { FailureCopy } from "../failure-copy/failure-copy.js";

export interface AuthAction {
  readonly label: string;
  readonly href: string;
  readonly onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
}

export interface AuthExit {
  readonly label: string;
  readonly onPress: () => void;
}

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

export function AuthPage({
  mark,
  title,
  description,
  error,
  action,
  footnote,
  foot,
  exit,
  children,
}: {
  mark?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  error?: ShownError | undefined;
  action?: AuthAction | undefined;
  footnote?: ReactNode;
  foot?: ReactNode;
  exit?: AuthExit | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  return (
    <main className="ui-auth-page @container relative grid grid-cols-1 place-items-center min-h-dvh p-page-inset box-border">
      <section
        className="ui-auth-card flex flex-col items-center w-full max-w-auth-card box-border border border-border rounded-dialog bg-surface shadow-auth-card text-foreground font-ui text-body text-center wrap-anywhere"
        aria-labelledby={titleId}
      >
        {said(mark) ? (
          <div className="ui-auth-mark inline-flex max-w-full" aria-hidden="true">
            {mark}
          </div>
        ) : null}
        <h1
          className="ui-auth-title mt-ui-16 first:mt-0 mb-0 mx-0 text-title font-title tracking-title text-balance"
          id={titleId}
        >
          {title}
        </h1>
        {said(description) ? (
          <p className="ui-auth-description m-0 mt-ui-8 text-muted-foreground text-label">
            {description}
          </p>
        ) : null}
        {Children.toArray(children).some(said) ? (
          <div className="ui-auth-body flex flex-col self-stretch gap-ui-12 mt-ui-32 text-start">
            {children}
          </div>
        ) : null}
        {said(foot) ? (
          <div className="ui-auth-foot @container/ui-auth-foot self-stretch mt-ui-24">{foot}</div>
        ) : null}
        <p className="ui-auth-error m-0 mt-ui-16 empty:mt-0 text-danger" role="alert">
          {error !== undefined && said(error.words) ? error.words : null}
        </p>
        {error !== undefined && said(error.words) && isReported(error.failure) ? (
          <div className="ui-auth-error-copy mt-ui-4 flex justify-center">
            <FailureCopy failure={error.failure} size={BUTTON_SIZE.COMPACT} />
          </div>
        ) : null}
        {action === undefined ? null : (
          <div className="ui-auth-action flex justify-center mt-ui-24">
            <ButtonLink
              href={action.href}
              variant={BUTTON_VARIANT.OUTLINE}
              onClick={action.onClick}
            >
              {action.label}
            </ButtonLink>
          </div>
        )}
        {said(footnote) ? (
          <p className="ui-auth-footnote m-0 mt-ui-16 text-muted-foreground text-caption">
            {footnote}
          </p>
        ) : null}
      </section>
      {exit === undefined ? null : (
        <div className="ui-auth-exit absolute top-ui-8 end-column-inset">
          <Button variant={BUTTON_VARIANT.QUIET} onClick={exit.onPress}>
            {exit.label}
          </Button>
        </div>
      )}
    </main>
  );
}
