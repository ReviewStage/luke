import type { PlatformError } from "@effect/platform/Error";
import type { VoiceCapabilityApplication } from "@sidecar/voice";
import { Effect } from "effect";

/**
 * One voice source transition, from the seams the host owns: the brain
 * wiring's retire, the assembler's application, and the rebuild that installs
 * what the applied capability allows. The retire is immediate — its own work
 * is synchronous and it is run before anything here suspends — so no run keeps
 * the old source's authority past the transition's first suspension. The rebuild belongs to the current application alone, asked at the
 * moment of use rather than read off the answer: a newer transition can begin
 * between the assembler's publication and this continuation, and it has
 * already retired the wiring, so a rebuild on the older one's behalf would be
 * the newest thing the host was asked for and would install the retired
 * source over the selection still being read. An overtaken transition builds
 * nothing and leaves the host empty for the newer one to fill. Answers
 * whether this transition was the one that installed.
 */
export interface VoiceSourceTransitionSeams {
  retire: () => Effect.Effect<void>;
  apply: () => Effect.Effect<VoiceCapabilityApplication, PlatformError>;
  rebuild: () => Effect.Effect<void>;
}

export function transitionVoiceSource(
  seams: VoiceSourceTransitionSeams,
): Effect.Effect<boolean, PlatformError> {
  return Effect.gen(function* () {
    yield* seams.retire();
    const applied = yield* seams.apply();
    if (!applied.latest || !applied.isCurrent()) return false;
    yield* seams.rebuild();
    return true;
  });
}
