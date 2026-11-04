import type { InboxItem } from "@repo/features/inbox-wire";
import { LIST_VARIANT, List, ListRow } from "@repo/ui";
import { InboxIcon } from "@repo/ui/icons";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { NEEDS_YOU, threadsWaitingWords } from "./inbox-model.js";

/**
 * threads-dock.tsx -- the line docked over an agent's box while threads it posted wait on the developer.
 *
 * Threads are answered in the Inbox alone, so the agent's tab points to
 * them rather than drawing them: one row, as the pull request's dock is
 * one, names the thread waiting, its title and Needs you, or, where
 * several wait, how many and the next one's title, the oldest posted
 * first, the title left out under a finger, where the row has no room for
 * both; pressing it opens the Inbox narrowed to the task on that thread.
 */

/** The threads an agent posted that wait on the developer, the oldest posted first, and the door to one of them in the Inbox. */
export interface AgentThreads {
  readonly waiting: readonly InboxItem[];
  readonly onOpen: (item: InboxItem) => void;
}

/** The agent's waiting threads as one row over its box; nothing while none waits. */
export function ThreadsDock({ threads }: { threads: AgentThreads | undefined }): ReactNode {
  const coarse = useCoarsePointer();
  const next = threads?.waiting[0];
  if (threads === undefined || next === undefined) return null;
  const many = threads.waiting.length > 1;
  const nextWords = coarse ? undefined : next.title;
  return (
    <div className={`agent-threads-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label={TAB_WORDS.INBOX} variant={LIST_VARIANT.CARD} fingerTall>
        <ListRow
          leading={<InboxIcon aria-hidden="true" />}
          title={many ? threadsWaitingWords(threads.waiting.length) : next.title}
          meta={many ? nextWords : NEEDS_YOU.LABEL}
          onPress={() => threads.onOpen(next)}
        />
      </List>
    </div>
  );
}
