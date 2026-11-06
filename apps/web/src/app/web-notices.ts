import type { AgentNoticeDoorsSurface } from "@repo/host/agent-notices";

const INSTALLED_DISPLAY = "(display-mode: standalone)";

const TITLE_COUNT = /^\(\d+\) /u;

interface BadgeDoor {
  readonly set: (count: number) => void;
  readonly close: () => void;
}

export interface WebNoticeDoors extends AgentNoticeDoorsSurface {
  close: () => void;
}

function titleBadge(): BadgeDoor {
  let count = 0;
  let watch: MutationObserver | undefined;
  const apply = () => {
    const bare = document.title.replace(TITLE_COUNT, "");
    const next = count > 0 ? `(${count}) ${bare}` : bare;
    if (document.title !== next) document.title = next;
  };
  return {
    set: (next) => {
      count = next;
      apply();
      if (watch !== undefined || count === 0) return;
      watch = new MutationObserver(apply);
      watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    },
    close: () => {
      watch?.disconnect();
      watch = undefined;
      count = 0;
      apply();
    },
  };
}

function runsInstalled(): boolean {
  return "matchMedia" in window && window.matchMedia(INSTALLED_DISPLAY).matches;
}

function badgeDoor(): BadgeDoor {
  if ("setAppBadge" in navigator && runsInstalled()) {
    const set = (count: number) => {
      const asked = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
      asked.catch(() => undefined);
    };
    return { set, close: () => set(0) };
  }
  return titleBadge();
}

export function onTabShownChanged(listener: (shown: boolean) => void): () => void {
  const said = () => listener(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", said);
  said();
  return () => document.removeEventListener("visibilitychange", said);
}

export function webNoticeDoors(): WebNoticeDoors {
  const badge = badgeDoor();
  return {
    post: () => undefined,
    badge: badge.set,
    close: badge.close,
  };
}
