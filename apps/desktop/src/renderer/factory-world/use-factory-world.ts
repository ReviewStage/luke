import {
  FACTORY_WORLD_CALL_FAILURE,
  type FactoryWorldView as FactoryWorldAnswer,
} from "@luke/features/factory-world-view";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMinute } from "../tasks/task-time";

/**
 * use-factory-world.ts -- the world a Factory world draws: one workspace's snapshot, read as the world opens and again every few minutes while it is on screen.
 *
 * Each read costs the service a tree read and a few manifests on GitHub, so
 * it is read once as a world is chosen and then each `REFRESH_MS` it stands
 * on screen, not each minute as a list is; Retry reads it at once. A refresh
 * that fails keeps the world it would have replaced, and only a first read
 * that fails is said as one. Nothing is held past the page.
 */

/** How long a world stands on screen before it is read again. */
const REFRESH_MS = 3 * 60_000;

const UNANSWERED = { failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED } as const;

/** The world as the page draws it: read, null with no repository to draw, failed, or not yet read. */
type WorldRead = FactoryWorldAnswer | undefined;

/** A read held with the workspace it is of, so another workspace's world is never drawn as this one's. */
interface HeldRead {
  readonly workspaceId: string;
  readonly read: WorldRead;
}

/** One workspace's world, none asked for while no workspace is listed, read again while `shown`. */
export function useFactoryWorld(workspaceId: string | undefined, shown: boolean) {
  const { act } = useAct();
  const now = useMinute();
  const [held, setHeld] = useState<HeldRead | undefined>(undefined);
  // Note that every read moves the generation on, so only the newest is taken.
  const generation = useRef(0);
  const readAt = useRef(now);
  const minute = useRef(now);
  minute.current = now;
  const reload = useCallback(() => {
    generation.current += 1;
    readAt.current = minute.current;
    if (workspaceId === undefined) return;
    const asked = generation.current;
    const taken = (read: FactoryWorldAnswer) => {
      if (asked !== generation.current) return;
      setHeld((was) =>
        "failure" in read &&
        was?.workspaceId === workspaceId &&
        was.read !== undefined &&
        !("failure" in was.read)
          ? was
          : { workspaceId, read },
      );
    };
    act(ACT_KIND.FACTORY_WORLD, { workspaceId }).then(taken, () => taken(UNANSWERED));
  }, [act, workspaceId]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (shown && now - readAt.current >= REFRESH_MS) reload();
  }, [now, shown, reload]);
  const read = held !== undefined && held.workspaceId === workspaceId ? held.read : undefined;
  return { read, reload };
}
