import type { InboxItem } from "@repo/features/inbox-wire";
import { LIST_VARIANT, List, ListRow } from "@repo/ui";
import { InboxIcon } from "@repo/ui/icons";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { NEEDS_YOU, threadsWaitingWords, threadsWords } from "./inbox-model.js";

/**
 * threads-dock.tsx -- the line docked over an agent's box while it has posted threads: what waits on the developer, or, quiet, how many there are.
 *
 * The agent's transcript points to its threads rather than drawing them:
 * one row, as the pull request's dock is one, names the thread waiting,
 * its title and Needs you, or, where several wait, how many and the next
 * one's title, the oldest posted first, the title left out under a finger,
 * where the row has no room for both; pressing it opens the agent's threads
 * in its card on that thread (`agent-threads.tsx`), or, on a phone, the
 * Inbox narrowed to the task on it. Once none waits it stays, quiet, as the
 * one way into them from the card: muted, counting every thread the agent
 * posted, and opening on the latest changed.
 */

/** The threads an agent posted, those that wait on the developer apart, and the door to one of them. */
export interface AgentThreads {
  /** Those that wait on the developer, the oldest posted first. */
  readonly waiting: readonly InboxItem[];
  /** Every thread the agent posted, waiting or not, the latest changed first. */
  readonly posted: readonly InboxItem[];
  readonly onOpen: (item: InboxItem) => void;
}

/** The agent's threads as one row over its box: what waits, else quiet, how many; nothing while it posted none. */
export function ThreadsDock({ threads }: { threads: AgentThreads | undefined }): ReactNode {
  const coarse = useCoarsePointer();
  const latest = threads?.posted[0];
  if (threads === undefined || latest === undefined) return null;
  const next = threads.waiting[0];
  const many = threads.waiting.length > 1;
  const row =
    next === undefined ? (
      <ListRow
        leading={<InboxIcon aria-hidden="true" />}
        title={threadsWords(threads.posted.length)}
        muted
        onPress={() => threads.onOpen(latest)}
      />
    ) : (
      <ListRow
        leading={<InboxIcon aria-hidden="true" />}
        title={many ? threadsWaitingWords(threads.waiting.length) : next.title}
        meta={many ? (coarse ? undefined : next.title) : NEEDS_YOU.LABEL}
        onPress={() => threads.onOpen(next)}
      />
    );
  return (
    <div className={`agent-threads-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label={TAB_WORDS.INBOX} variant={LIST_VARIANT.CARD} fingerTall>
        {row}
      </List>
    </div>
  );
}
