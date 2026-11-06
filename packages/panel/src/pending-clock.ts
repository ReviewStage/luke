import { useAtomValue } from "@effect/atom-react";
import { Clock, Duration, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { rendererRuntime } from "./renderer-runtime.js";

const PENDING_TICK = Duration.seconds(5);

const pendingClockAtom = rendererRuntime.atom(
  Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(PENDING_TICK)),
);

const NO_PENDING_CLOCK = Atom.make(AsyncResult.initial<number>());

export function usePendingNow(waiting: boolean): number | undefined {
  return Option.getOrUndefined(
    AsyncResult.value(useAtomValue(waiting ? pendingClockAtom : NO_PENDING_CLOCK)),
  );
}
