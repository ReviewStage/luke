import type { VoiceCapabilityApplication } from "@sidecar/voice";

/**
 * One credential transition, from the seams main owns: the brain host's
 * synchronous retire, the assembler's application, and the rebuild that
 * installs what the applied capability allows. The retire is immediate, so no
 * run keeps the old source's authority past the transition's first await. The
 * rebuild belongs to the current application alone, asked at the moment of
 * use rather than read off the answer: a newer transition can begin between
 * the assembler's publication and this continuation, and it has already
 * retired the host, so a rebuild on the older one's behalf would be the
 * newest thing the host was asked for and would install the retired source
 * over the selection still being read. An overtaken transition builds nothing
 * and leaves the host empty for the newer one to fill. Answers whether this
 * transition was the one that installed.
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
  if (!applied.latest || !applied.isCurrent()) return false;
  await seams.rebuild();
  return true;
}
