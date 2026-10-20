import type { SessionReplayBootstrap } from "@luke/gateway/window-session";
import type { AppState } from "@luke/host/app-state";
import { sessionReplayBootstrap } from "@luke/host/app-state";
import { useCallback, useEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { usePrefetchEditorBundle } from "./bundle-loader.js";
import { prefetchMarkdownHtmlParser } from "./markdown-html-parser.js";
import { IDLE_TIMEOUT_MS, useWhenIdle } from "./use-when-idle.js";

/**
 * use-startup-work.ts -- the panel's side work after its first commit: session replay, and the editor and markdown parser chunks warmed for a later click, each started once the renderer is idle rather than beside the first interactions.
 */

/**
 * Recording follows the account: a sign-out ends it rather than leaving it
 * filed under the person who just left, and a sign-in can start one without
 * waiting for a relaunch. The document is the whole of what decides it, so
 * a halt raised before the account was cleared can never be undone by an
 * older reading arriving behind it.
 *
 * The first word on recording waits for an idle moment (the recorder's chunks
 * are some 150 KB gzipped to parse), and the latest word at that time is the
 * one it carries. Every word after that reaches the platform at once, so a
 * halt or a sign-out is never held back, but only when the word differs: a
 * delivery of the document that moved nothing recording reads is not a word.
 */
export function useSessionReplay(
  run: AppState["run"] | undefined,
  sessionReplay: AppState["sessionReplay"] | undefined,
): void {
  /** The word the platform last heard, so a delivery that moved nothing is not another. */
  const applied = useRef<SessionReplayBootstrap | undefined>(undefined);
  const started = useRef(false);
  const latest = useRef<SessionReplayBootstrap | undefined>(undefined);
  const tell = useCallback((word: SessionReplayBootstrap | undefined) => {
    if (!word || sameWord(applied.current, word)) return;
    applied.current = word;
    appPlatform().applySessionReplay(word);
  }, []);
  useEffect(() => {
    latest.current =
      run && sessionReplay ? sessionReplayBootstrap({ run, sessionReplay }) : undefined;
    if (started.current) tell(latest.current);
  }, [run, sessionReplay, tell]);
  useWhenIdle(() => {
    started.current = true;
    tell(latest.current);
  }, IDLE_TIMEOUT_MS.SESSION_REPLAY);
}

/** Whether two words on recording say the same thing. */
function sameWord(
  before: SessionReplayBootstrap | undefined,
  after: SessionReplayBootstrap,
): boolean {
  return (
    before !== undefined &&
    before.permitted === after.permitted &&
    before.appVersion === after.appVersion &&
    before.packaged === after.packaged &&
    before.accountId === after.accountId
  );
}

/**
 * The editor bundle loads once the panel has been idle, so an agent's message
 * box and a plan's editor find it there; so does the parser a reply's markdown
 * is drawn through, so a transcript opened finds it there. Each surface that
 * needs either reads it itself and loads it at once, and a plan's text still
 * warms the editor as the pointer comes over it, so this is only the warm-up.
 */
export function usePrefetchBundles(): void {
  const prefetchEditorBundle = usePrefetchEditorBundle();
  useWhenIdle(() => {
    prefetchEditorBundle();
    prefetchMarkdownHtmlParser();
  }, IDLE_TIMEOUT_MS.PREFETCH);
}
