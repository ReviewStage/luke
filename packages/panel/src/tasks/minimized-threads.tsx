import type { ReviewThread } from "@repo/features/agent-wire";
import { DISCLOSURE_SUMMARY, DisclosureSummary, Tooltip } from "@repo/ui";
import { actorName } from "@repo/ui/actor-model";
import { CircleCheckIcon, CircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { Fold, FoldBody } from "../ai-elements/fold.js";
import { useNamer } from "./pull-request-people.js";

const CHIP_FACES = 4;

const CHIP_WORDS = {
  comments: (count: number) => (count === 1 ? "1 comment" : `${count} comments`),
  open: (count: number) => (count === 0 ? "all resolved" : `${count} open`),
  SHOW: "show",
  HIDE: "hide",
  SHOW_HINT: "Show comments",
  HIDE_HINT: "Hide comments",
} as const;

function writersOf(threads: readonly ReviewThread[]) {
  const seen = new Map<string, ReviewThread["comments"][number]["by"]>();
  for (const comment of threads.flatMap((thread) => thread.comments)) {
    if (!seen.has(comment.by.login)) seen.set(comment.by.login, comment.by);
  }
  return [...seen.values()];
}

function MinimizedChip({
  label,
  faces,
  count,
  resolved,
  shown,
  onShown,
  above = false,
  children,
}: {
  label: string;
  faces: ReactNode;
  count: number;
  resolved?: boolean | undefined;
  above?: boolean;
  shown: boolean;
  onShown: (shown: boolean) => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Fold
      className="diff-thread-chip-row flex flex-col gap-tight-gap"
      data-above={above ? "" : undefined}
      open={shown}
      onOpenChange={onShown}
    >
      <Tooltip label={shown ? CHIP_WORDS.HIDE_HINT : CHIP_WORDS.SHOW_HINT}>
        <DisclosureSummary look={DISCLOSURE_SUMMARY.CHIP} aria-label={label}>
          {resolved === undefined ? null : resolved ? (
            <CircleCheckIcon className="text-complete" aria-hidden="true" />
          ) : (
            <CircleIcon aria-hidden="true" />
          )}
          <span className="diff-thread-chip-faces inline-flex">{faces}</span>
          {count}
        </DisclosureSummary>
      </Tooltip>
      <FoldBody className="diff-thread-chip-threads flex flex-col gap-item-gap">
        {children}
      </FoldBody>
    </Fold>
  );
}

function chipPress(shown: boolean): string {
  return shown ? CHIP_WORDS.HIDE : CHIP_WORDS.SHOW;
}

export function MinimizedThreads({
  threads,
  shown,
  onShown,
  above = false,
  children,
}: {
  threads: readonly ReviewThread[];
  above?: boolean;
  shown: boolean;
  onShown: (shown: boolean) => void;
  children: ReactNode;
}): React.JSX.Element {
  const name = useNamer();
  const writers = writersOf(threads).map(name);
  const count = threads.reduce((sum, thread) => sum + thread.comments.length + thread.more, 0);
  const open = threads.filter((thread) => !thread.resolved).length;
  const label = [
    `${CHIP_WORDS.comments(count)} by ${writers.map((writer) => actorName(writer)).join(", ")}`,
    `${CHIP_WORDS.open(open)}, ${chipPress(shown)}`,
  ].join(" · ");
  return (
    <MinimizedChip
      label={label}
      faces={writers
        .slice(0, CHIP_FACES)
        .map((writer, at) => <ActorMark key={at} actor={writer} size={ACTOR_SIZE.MARK} tiled />)}
      count={count}
      resolved={open === 0}
      shown={shown}
      onShown={onShown}
      above={above}
    >
      {children}
    </MinimizedChip>
  );
}
