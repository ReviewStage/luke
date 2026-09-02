import type { SessionAnnouncement } from "@sidecar/realtime";
import type { SessionIdentity } from "@sidecar/session";

type Timer = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => Timer;
type Cancel = (timer: Timer) => void;

/**
 * Names the work each announcement is about, derived at the moment of
 * delivery from the session's transcript as it stands then. Every derivation
 * races one shared deadline: an announcement whose derivation settled with a
 * phrase in time carries it as `subject`, and one whose derivation failed,
 * answered nothing, or outran the deadline goes out unchanged, because speech
 * is never held past the deadline for a name. A late answer is discarded, and
 * an empty batch arms no timer.
 */
export async function withSubjects(
  announcements: readonly SessionAnnouncement[],
  deriveFor: (identity: SessionIdentity) => Promise<string | undefined>,
  deadlineMs: number,
  schedule: Schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: Cancel = (timer) => clearTimeout(timer),
): Promise<readonly SessionAnnouncement[]> {
  if (announcements.length === 0) return announcements;
  let timer: Timer | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = schedule(() => resolve(undefined), deadlineMs);
    timer.unref?.();
  });
  const subjects = await Promise.all(
    announcements.map((announcement) =>
      Promise.race([
        deriveFor({
          providerId: announcement.providerId,
          providerSessionId: announcement.providerSessionId,
        }).catch(() => undefined),
        deadline,
      ]),
    ),
  );
  if (timer !== undefined) cancel(timer);
  return announcements.map((announcement, index) => {
    const subject = subjects[index];
    return subject ? { ...announcement, subject } : announcement;
  });
}
