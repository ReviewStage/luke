import { Duration } from "effect";
import { CODER } from "./coder-host/bounds.js";

export function keepAliveDue(keptAliveAt: number | undefined, now: number): boolean {
  return (
    keptAliveAt === undefined ||
    now - keptAliveAt >= Duration.toMillis(CODER.SANDBOX_KEEP_ALIVE_EVERY)
  );
}

export function keepAliveExtension(endsAt: number, now: number): number | undefined {
  const wanted = now + CODER.SANDBOX_TIMEOUT_MS - endsAt;
  return wanted < Duration.toMillis(CODER.SANDBOX_KEEP_ALIVE_EVERY) ? undefined : wanted;
}
