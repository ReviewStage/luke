import { type Context, Effect, Schema } from "effect";
import type * as FileSystem from "effect/FileSystem";
import { jsonStateFileEffect } from "./effect/json-state-file.js";
import { Reporter, StateRoot } from "./effect/seams.js";

/** The onboarding record, in the app's own state directory. */
export const ONBOARDING_STATE_FILE = "onboarding.json";

/** One moment, as every field of the record holds it: an instant in words, or nothing. */
const moment = Schema.optionalWith(Schema.String, { exact: true });

/**
 * The one-time onboarding moments Luke remembers per install: the spoken
 * introduction, the arrival beat, and the calendar step. One record, because
 * every field is written by the same launch and read by the same reconcile.
 */
const OnboardingStateSchema = Schema.Struct({
  /**
   * When the install's first observed sign-in owed the spoken introduction.
   * Recorded at that edge alone, so an install already signed in when this
   * build arrived is never greeted as a stranger on an upgrade.
   */
  introductionRequiredAt: moment,
  /** When the spoken introduction finished, to the end. */
  introductionCompletedAt: moment,
  /** When the account's first sign-in landed, as this install observed it. */
  arrivalSignedInAt: moment,
  /** When the arrival beat stopped being owed: its reply actually began. */
  arrivalSpokenAt: moment,
  /** When the first announcement after that sign-in was spoken. */
  arrivalFirstAnnouncementAt: moment,
  /** When the install's first observed sign-in put the Conductor key gate up, ahead of the calendar's. */
  conductorKeyOnboardingRequiredAt: moment,
  /** When the key gate stopped standing: the vault came to hold a Conductor key. */
  conductorKeyOnboardingSettledAt: moment,
  /** When the developer declined the key step instead; the gate stands down the same way. */
  conductorKeyOnboardingSkippedAt: moment,
  /** When the install's first observed sign-in put the calendar gate up. */
  calendarOnboardingRequiredAt: moment,
  /**
   * When the calendar gate stopped standing: Done confirmed the connected
   * calendars, or a calendar already standing was recognized.
   */
  calendarOnboardingSettledAt: moment,
  /**
   * When the user declined the calendar step instead. Its own field rather
   * than a settle, so the record keeps what actually happened, but it stands
   * the gate down the same way.
   */
  calendarOnboardingSkippedAt: moment,
});

export type OnboardingState = typeof OnboardingStateSchema.Type;

const onboardingStateFile = jsonStateFileEffect({
  fileName: ONBOARDING_STATE_FILE,
  schema: OnboardingStateSchema,
});

/** The record as one reader and one writer, with every seam the file needs already provided. */
export interface OnboardingStateRecord {
  /**
   * The stored record, or nothing for one with no moment in it at all, for one
   * that is absent, and for one this build cannot read. "No record" and "an
   * empty record" are one answer, because every predicate over this state
   * treats an absent moment as never observed — the safe direction, since it
   * can only withhold a beat or a gate, never replay one already given.
   */
  readonly read: Effect.Effect<OnboardingState | undefined>;
  /**
   * Persists `mutate`'s answer over whatever is on disk at this moment, rather
   * than over a record read earlier, and answers what was persisted. Two
   * processes write Luke's onboarding record, each owning its own moments, and
   * one saving over its own older read would drop the other's.
   */
  readonly update: (
    mutate: (current: OnboardingState | undefined) => OnboardingState,
  ) => Effect.Effect<OnboardingState>;
}

export function onboardingStateRecord(
  stateRoot: string,
  report: (message: string) => void,
  fileSystem: Context.Context<FileSystem.FileSystem>,
): OnboardingStateRecord {
  const provided = <A>(
    effect: Effect.Effect<A, never, FileSystem.FileSystem | StateRoot | Reporter>,
  ): Effect.Effect<A> =>
    effect.pipe(
      Effect.provideService(StateRoot, stateRoot),
      Effect.provideService(Reporter, { report }),
      Effect.provide(fileSystem),
    );
  return {
    read: provided(onboardingStateFile.read),
    update: (mutate) => provided(onboardingStateFile.update(mutate)),
  };
}
