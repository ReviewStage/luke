import { useAtomSubscribe, useAtomValue } from "@effect/atom-react";
import { Clock, Duration, Layer, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useCallback } from "react";

const MINUTE_TICK = Duration.minutes(1);

const SECOND_TICK = Duration.seconds(1);

const BEAT_TICK = Duration.millis(200);

function ticksEvery(wait: Duration.Duration): Stream.Stream<number> {
  return Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(wait));
}

export const timeRuntime = Atom.keepAlive(Atom.runtime(Layer.empty));

const minuteAtom = timeRuntime.atom(ticksEvery(MINUTE_TICK));
const secondAtom = timeRuntime.atom(ticksEvery(SECOND_TICK));

const beatAtom = timeRuntime.atom(
  Stream.fromSchedule(Schedule.spaced(BEAT_TICK)).pipe(Stream.map((recurrence) => recurrence + 1)),
);

export function useMinute(): number {
  return AsyncResult.getOrElse(useAtomValue(minuteAtom), () => Date.now());
}

export function useSecond(): number {
  return AsyncResult.getOrElse(useAtomValue(secondAtom), () => Date.now());
}

export function useOnBeat(onBeat: (beat: number) => void): void {
  const listen = useCallback(
    (result: Atom.Type<typeof beatAtom>) => {
      if (AsyncResult.isSuccess(result)) onBeat(result.value);
    },
    [onBeat],
  );
  useAtomSubscribe(beatAtom, listen, { immediate: true });
}
