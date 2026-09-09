import type { VoiceOrchestrator } from "@sidecar/voice/orchestrator";
import { useEffect } from "react";
import { useAppState } from "../use-app-state";

/**
 * The thread's one way in from the main process. The stored conversation
 * arrives in the document like everything else, so this is two readings of
 * the same slice and nothing more: the adoption, held until the settings
 * arrive — a snapshot without them is one the host has not answered for yet,
 * and the thread it carries is empty by default rather than by fact — and,
 * after it, every later slice another writer left, which the orchestrator
 * merges into what this window is still holding.
 */
export function useVoiceThread(orchestrator: VoiceOrchestrator<MediaStream>): void {
  const state = useAppState();
  const settled = state?.settings !== undefined;
  const conversation = state?.conversation;
  const epoch = state?.voice.epoch;
  useEffect(() => {
    if (!settled || conversation === undefined) return;
    orchestrator.applyBootstrap({ conversation, epoch });
    orchestrator.observeConversation(conversation);
  }, [conversation, epoch, orchestrator, settled]);
}
