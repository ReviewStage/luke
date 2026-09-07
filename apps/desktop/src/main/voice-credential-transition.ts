import type { VoiceCapabilityApplication } from "@sidecar/voice";

/**
 * One credential transition, from the seams main owns: the brain host's
 * synchronous retire, the assembler's application, and the rebuild that
 * installs what the applied capability allows. The retire is immediate, so no
 * run keeps the old source's authority past the transition's first await. The
 * rebuild belongs to the latest application alone: an older transition whose
 * reads finished late has already been overtaken, and a rebuild on its behalf
 * would retire the agent the newer transition correctly installed and
 * interrupt every run on it. Answers whether this transition was the one that
 * installed.
 */
export interface VoiceCredentialTransitionSeams {
  retire: () => void;
  apply: () => Promise<VoiceCapabilityApplication>;
  rebuild: () => Promise<void>;
}

export async function transitionVoiceCredential(
  seams: VoiceCredentialTransitionSeams,
): Promise<boolean> {
  seams.retire();
  const applied = await seams.apply();
  if (!applied.latest) return false;
  await seams.rebuild();
  return true;
}
