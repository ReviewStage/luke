import type { AppState } from "@repo/host/app-state";
import { sessionReplayBootstrap } from "@repo/host/app-state";
import { useCallback, useEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { usePrefetchEditorBundle } from "./bundle-loader.js";
import { prefetchMarkdownHtmlParser } from "./markdown-html-parser.js";
import type { SessionReplayWord } from "./session-replay.js";
import { IDLE_TIMEOUT_MS, useWhenIdle } from "./use-when-idle.js";

export function useSessionReplay(
  run: AppState["run"] | undefined,
  sessionReplay: AppState["sessionReplay"] | undefined,
  workspaceId: string | undefined,
): void {
  const applied = useRef<SessionReplayWord | undefined>(undefined);
  const started = useRef(false);
  const latest = useRef<SessionReplayWord | undefined>(undefined);
  const tell = useCallback((word: SessionReplayWord | undefined) => {
    if (!word || sameWord(applied.current, word)) return;
    applied.current = word;
    appPlatform().applySessionReplay(word);
  }, []);
  useEffect(() => {
    latest.current =
      run && sessionReplay
        ? {
            ...sessionReplayBootstrap({ run, sessionReplay }),
            ...(workspaceId ? { workspaceId } : undefined),
          }
        : undefined;
    if (started.current) tell(latest.current);
  }, [run, sessionReplay, workspaceId, tell]);
  useWhenIdle(() => {
    started.current = true;
    tell(latest.current);
  }, IDLE_TIMEOUT_MS.SESSION_REPLAY);
}

function sameWord(before: SessionReplayWord | undefined, after: SessionReplayWord): boolean {
  return (
    before !== undefined &&
    before.permitted === after.permitted &&
    before.appVersion === after.appVersion &&
    before.packaged === after.packaged &&
    before.accountId === after.accountId &&
    before.name === after.name &&
    before.email === after.email &&
    before.workspaceId === after.workspaceId
  );
}

export function usePrefetchBundles(): void {
  const prefetchEditorBundle = usePrefetchEditorBundle();
  useWhenIdle(() => {
    prefetchEditorBundle();
    prefetchMarkdownHtmlParser();
  }, IDLE_TIMEOUT_MS.PREFETCH);
}
