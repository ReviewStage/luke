import type { InboxItem } from "@repo/features/inbox-wire";
import { LIST_VARIANT, List, ListRow } from "@repo/ui";
import { InboxIcon } from "@repo/ui/icons";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { NEEDS_YOU, threadsWaitingWords } from "./inbox-model.js";

export interface AgentThreads {
  readonly waiting: readonly InboxItem[];
  readonly onOpen: (item: InboxItem) => void;
}

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
