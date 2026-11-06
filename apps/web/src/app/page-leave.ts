import type { AppPlatform } from "@repo/panel/app-platform";

type LeaveAsk = Parameters<NonNullable<AppPlatform["unsavedWork"]>>[0];

export interface LeavingPage {
  readonly addEventListener: (type: "beforeunload", listener: (event: Event) => void) => void;
  readonly removeEventListener: (type: "beforeunload", listener: (event: Event) => void) => void;
}

export interface PageLeave {
  readonly unsavedWork: (ask: LeaveAsk) => void;
  readonly unsavedDescriptionWords: (unsaved: boolean) => void;
  readonly leave: (go: () => void) => void;
}

export function pageLeave(page: LeavingPage): PageLeave {
  let standing: LeaveAsk;
  let descriptionWords = false;
  let listening = false;
  let leaving = false;

  const holdBack = (event: Event): void => {
    if (leaving) {
      leaving = false;
      return;
    }
    event.preventDefault();
    event.returnValue = true;
  };

  const listen = (): void => {
    const hold = standing !== undefined || descriptionWords;
    if (hold && !listening) page.addEventListener("beforeunload", holdBack);
    if (!hold && listening) page.removeEventListener("beforeunload", holdBack);
    listening = hold;
  };

  const unsavedWork = (ask: LeaveAsk): void => {
    if (ask !== undefined) leaving = false;
    standing = ask;
    listen();
  };

  const unsavedDescriptionWords = (next: boolean): void => {
    if (next && !descriptionWords) leaving = false;
    descriptionWords = next;
    listen();
  };

  const take = (go: () => void): void => {
    leaving = !descriptionWords;
    go();
  };

  const leave = (go: () => void): void => {
    const ask = standing;
    if (ask === undefined) {
      go();
      return;
    }
    ask(() => take(go));
  };

  return { unsavedWork, unsavedDescriptionWords, leave };
}

export function tabLeave(): PageLeave {
  return pageLeave(window);
}
