import { type AppStateSnapshot, RUN_PROFILE } from "@luke/host/app-state";
import { EXPERIMENT, experimentOn, NO_EXPERIMENTS } from "@luke/settings";
import type * as Atom from "effect/reactivity/Atom";
import { appStateDerivedAtom, useAppSlice } from "../use-app-state.js";

/**
 * chat-gate.ts -- whether the window offers Chat at all: the account's Chat experiment, or a fixture run staged on Chat.
 *
 * Chat is an experiment (`EXPERIMENT.CHAT`), so every door to it, its
 * sidebar row, its place, its tab, and what announces it, asks here and
 * stands nowhere while the answer is no. The one other yes is a fixture run
 * on the chat profile, which has no account to turn anything on and stages
 * its synthetic chat for `evidence.sh` to capture.
 */

/** Whether the run and the account it is signed in to offer Chat. */
function chatOffered(state: AppStateSnapshot | undefined): boolean {
  if (state?.run.fixtureMode === true && state.run.profile === RUN_PROFILE.CHAT) return true;
  return experimentOn(state?.settings?.experiments ?? NO_EXPERIMENTS, EXPERIMENT.CHAT);
}

/** The answer, judged once per delivery for every surface, which tells them only as it turns. */
const chatOnAtom: Atom.Atom<boolean> = appStateDerivedAtom(chatOffered);

/** Whether Chat is offered, as a surface reads it. */
export function useChatOn(): boolean {
  return useAppSlice(chatOnAtom);
}
