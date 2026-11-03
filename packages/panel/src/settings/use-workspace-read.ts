/**
 * use-workspace-read.ts -- a workspace's own integration as the service holds it now, for the rows that offer it: our Sentry integration, and our Slack bot.
 */

import type { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ActResult, useAct } from "../act.js";

/** The reads a workspace integration's row is drawn from, each naming the workspace alone. */
type WorkspaceReadKind =
  | typeof ACT_KIND.WORKSPACE_SENTRY_READ
  | typeof ACT_KIND.WORKSPACE_SLACK_BOT_READ;

/** The integration as a row reads it: still reading, read, or a read that did not land. */
type WorkspaceRead<Kind extends WorkspaceReadKind> =
  | { readonly answer: ActResult<Kind> }
  | { readonly failed: true }
  | undefined;

/** A read that did not land, which keeps no earlier answer. */
const WORKSPACE_READ_FAILED = { failed: true } as const;

/**
 * The workspace's integration as the service holds it now, read as the row
 * opens, again each time the window comes forward, which is how the
 * developer comes back from installing it in the browser, and again on
 * `retry`; nothing while the first read is out, and failed where the latest
 * read was refused, which stands until a later read answers.
 */
export function useWorkspaceRead<Kind extends WorkspaceReadKind>(kind: Kind, workspaceId: string) {
  const { act } = useAct();
  const [read, setRead] = useState<WorkspaceRead<Kind>>();
  const latest = useRef(0);
  const ask = useCallback(() => {
    const asked = ++latest.current;
    act<WorkspaceReadKind>(kind, { workspaceId }).then(
      (answer) => {
        // SAFETY: the answer is the one `kind`'s contract declares, which `act` checked.
        if (asked === latest.current) setRead({ answer: answer as ActResult<Kind> });
      },
      () => {
        // Note that a failed read forgets the last answer, because what it listed may be gone.
        if (asked === latest.current) setRead(WORKSPACE_READ_FAILED);
      },
    );
  }, [act, kind, workspaceId]);
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
    changed: (answer: ActResult<Kind>) => {
      latest.current += 1;
      setRead({ answer });
    },
  };
}
