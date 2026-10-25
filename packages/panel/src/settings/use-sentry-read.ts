/**
 * use-sentry-read.ts -- a workspace's Sentry as the service holds it now, for the rows that offer Luke's Sentry integration.
 */

import type { WorkspaceSentry } from "@luke/features/sentry-install-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";

/** The workspace's Sentry as a row reads it: still reading, read, or a read that did not land. */
type SentryRead =
  | { readonly sentry: WorkspaceSentry }
  | { readonly failed: true }
  | undefined;

/** A read that did not land, which keeps no earlier answer. */
const SENTRY_READ_FAILED = { failed: true } as const;

/**
 * The workspace's Sentry as the service holds it now, read as the row opens,
 * again each time the window comes forward, which is how the developer
 * comes back from installing on Sentry, and again on `retry`; nothing while
 * the first read is out, and failed where the latest read was refused, which
 * stands until a later read answers.
 */
export function useSentryRead(workspaceId: string) {
  const { act } = useAct();
  const [read, setRead] = useState<SentryRead>();
  const latest = useRef(0);
  const ask = useCallback(() => {
    const asked = ++latest.current;
    act(ACT_KIND.WORKSPACE_SENTRY_READ, { workspaceId }).then(
      (sentry) => {
        if (asked === latest.current) setRead({ sentry });
      },
      () => {
        // Note that a failed read forgets the last answer, because an installation it listed may be gone.
        if (asked === latest.current) setRead(SENTRY_READ_FAILED);
      },
    );
  }, [act, workspaceId]);
  useEffect(() => {
    setRead(undefined);
    ask();
    window.addEventListener("focus", ask);
    return () => {
      window.removeEventListener("focus", ask);
      latest.current += 1;
    };
  }, [ask]);
  return {
    read,
    retry: ask,
    changed: (sentry: WorkspaceSentry) => {
      latest.current += 1;
      setRead({ sentry });
    },
  };
}
