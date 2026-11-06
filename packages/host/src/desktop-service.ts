import type { Effect } from "effect";

export interface DesktopService {
  readonly name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface EffectDesktopService {
  readonly name: string;
  start: () => Effect.Effect<void>;
  stop: () => Effect.Effect<void>;
}
