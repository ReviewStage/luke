/**
 * use-sentry-read.ts -- a workspace's Sentry as the service holds it now, for the rows that offer Luke's Sentry integration.
 */

import type { WorkspaceSentry } from "@luke/features/sentry-install-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";

/**
 * The workspace's Sentry as the service holds it now, read as the row opens
 * and again each time the window comes forward, which is how the developer
 * comes back from installing on Sentry; nothing while the first read is out
 * or where the latest read failed.
 */
export function useSentryRead(workspaceId: string) {
  const { act } = useAct();
  const [read, setRead] = useState<WorkspaceSentry>();
  const latest = useRef(0);
  useEffect(() => {
    const ask = () => {
      const asked = ++latest.current;
      act(ACT_KIND.WORKSPACE_SENTRY_READ, { workspaceId }).then(
        (sentry) => {
          if (asked === latest.current) setRead(sentry);
        },
        () => {
          // Note that a failed read forgets the last answer, because an installation it listed may be gone.
          if (asked === latest.current) setRead(undefined);
        },
      );
    };
    setRead(undefined);
    ask();
    window.addEventListener("focus", ask);
    return () => {
      window.removeEventListener("focus", ask);
      latest.current += 1;
    };
  }, [act, workspaceId]);
  return {
    read,
    changed: (sentry: WorkspaceSentry) => {
      latest.current += 1;
      setRead(sentry);
    },
  };
}
