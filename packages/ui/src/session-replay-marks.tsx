import type { ReactNode } from "react";

const UNMASK = "data-replay-unmask";

const MASK = "data-replay-mask";

const EITHER_MARK = `[${UNMASK}], [${MASK}]`;

export const REPLAY_MASKED = { [MASK]: "" } as const;

const TYPED = 'textarea, [contenteditable]:not([contenteditable="false"])';

const IGNORED_INPUT = "ph-ignore-input";

export const REPLAY_LEFT_OUT = "ph-no-capture";

const WITHHELD = ".session-replay-withheld";

export function ignoredByReplay(input: HTMLInputElement | null): void {
  input?.classList.add(IGNORED_INPUT);
}

export function writeWithheldSheet(sheet: CSSStyleSheet, rules: string): void {
  sheet.replaceSync(`${WITHHELD} {}\n${rules}`);
}

export function opensWithheldSheet(css: string): boolean {
  return css.startsWith(WITHHELD);
}

export function ReplayUnmask({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="contents" {...{ [UNMASK]: "" }}>
      {children}
    </span>
  );
}

export function ReplayMask({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="contents" {...{ [MASK]: "" }}>
      {children}
    </span>
  );
}

export function ReplayWords({
  unmasked,
  masked = false,
  children,
}: {
  unmasked?: boolean | undefined;
  masked?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  if (unmasked === true && !masked) return <ReplayUnmask>{children}</ReplayUnmask>;
  return masked || unmasked === false ? <ReplayMask>{children}</ReplayMask> : <>{children}</>;
}

export function showsInReplay(element: Element | null | undefined): boolean {
  if (element === null || element === undefined || element.closest(TYPED) !== null) return false;
  return element.closest(EITHER_MARK)?.hasAttribute(UNMASK) === true;
}
