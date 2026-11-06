import { PRODUCT_NAME } from "@repo/features/product-name";
import { showToast } from "@repo/panel/toast";
import { STATUS_TONE } from "@repo/ui";
import { Effect } from "effect";
import type { PageLeave } from "./page-leave";

export const PRELOAD_ERROR = "vite:preloadError";

const PART_DID_NOT_LOAD = `Part of ${PRODUCT_NAME} could not load`;

export interface StaleBuildTab {
  readonly online: () => boolean;
  readonly leave: Pick<PageLeave, "leave">;
  readonly reload: () => void;
  readonly askReload: (reload: () => void, dismissed: () => void) => void;
}

export function failedChunkAnswer(tab: StaleBuildTab): () => Effect.Effect<void> {
  let asking = false;
  const answered = (): void => {
    asking = false;
  };
  const reload = (): void => {
    answered();
    tab.leave.leave(tab.reload);
  };
  return () =>
    Effect.sync(() => {
      if (asking || !tab.online()) return;
      asking = true;
      tab.askReload(reload, answered);
    });
}

export function staleBuildTab(leave: StaleBuildTab["leave"]): StaleBuildTab {
  return {
    online: () => navigator.onLine !== false,
    leave,
    reload: () => location.reload(),
    askReload: (reload, dismissed) =>
      showToast({
        words: PART_DID_NOT_LOAD,
        tone: STATUS_TONE.ATTENTION,
        action: { label: "Reload", onPress: reload },
        persists: true,
        onDismiss: dismissed,
      }),
  };
}
