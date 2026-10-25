import type { CodingAgentBrief, CodingAgentContext } from "@luke/features/coding-agent-wire";
import {
  AnchoredPopover,
  Fact,
  Facts,
  GAP,
  IconButton,
  LAYOUT_ELEMENT,
  POPOVER_ALIGN,
  PopoverPanel,
  Stack,
  Tooltip,
  useMinute,
} from "@luke/ui";
import { useId, useRef, useState } from "react";
import {
  CONTEXT_LEVEL,
  CONTEXT_PART,
  type ContextLevel,
  type ContextPart,
  contextFullLine,
  contextHint,
  contextLevel,
  contextRows,
  contextShare,
  contextStats,
  contextTotalLine,
  rowCount,
  rowWidth,
} from "./agent-context-model.js";

/**
 * agent-context.tsx -- the ring at the agent box's foot that shows how full the agent's model's context is, and the popover that says what fills it.
 *
 * Beside the model chip stands a small ring, the way Claude Code and
 * Cursor draw one, filled with the share of the window the agent's newest
 * step read and coloured by how near eve's compaction that is
 * (`agent-context-model.ts`); its hover says the share in words. A press
 * opens a popover right above the ring, the model menu's width, from the
 * ring's trailing edge as the model menu hangs from its chip, since both
 * stand at the foot's right (`@luke/ui`'s `AnchoredPopover` and
 * `PopoverPanel`). It says the
 * share and the total, draws the parts on one segmented bar, names each
 * part with its count beside a square of its colour, and under them the
 * cache, the step's answer, where eve compacts, and when it last did. The
 * ring stands only once a step has ended, since there is nothing to fill
 * it before. The popover closes on its ×, on Escape, which stops there so
 * the panel behind stays open, on a second press of the ring, and on focus
 * leaving it.
 */

/** The ring's radius and stroke in its 16-unit box, and the length of its circle. */
const RING_RADIUS = 6;
const RING_STROKE = 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** What the ring and its popover are called. */
const CONTEXT_LABEL = "Context usage";

/** The ring's fill: muted with room to spare, amber within a tenth of the window of eve's compaction, and red at or past it. */
const LEVEL_STROKE = {
  [CONTEXT_LEVEL.ROOM]: "stroke-muted-foreground",
  [CONTEXT_LEVEL.NEAR]: "stroke-attention",
  [CONTEXT_LEVEL.OVER]: "stroke-destructive",
} as const satisfies Record<ContextLevel, string>;

/** Each part of the context's one colour, on the bar and on its legend row's square. */
const PART_GROUND = {
  [CONTEXT_PART.SYSTEM_PROMPT]: "bg-chart-2",
  [CONTEXT_PART.TOOL_DEFINITIONS]: "bg-chart-1",
  [CONTEXT_PART.BRIEF]: "bg-chart-3",
  [CONTEXT_PART.CONVERSATION]: "bg-muted-foreground",
} as const satisfies Record<ContextPart, string>;

/** The ring itself: a faint track and the share filled over it, from twelve o'clock. */
function ContextRing({ share, level }: { share: number; level: ContextLevel }): React.JSX.Element {
  const filled = Math.min(1, Math.max(0, share)) * RING_LENGTH;
  return (
    <svg className="-rotate-90 fill-none" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        className="stroke-border-strong"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeWidth={RING_STROKE}
      />
      <circle
        className={`transition-[stroke-dasharray] ${LEVEL_STROKE[level]}`}
        strokeLinecap="round"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeWidth={RING_STROKE}
        strokeDasharray={`${filled} ${RING_LENGTH}`}
      />
    </svg>
  );
}

/** What the popover holds: the summary, the bar, each part's row and the stats, which tick on for as long as it is drawn. */
function ContextBody({
  context,
  brief,
}: {
  context: CodingAgentContext;
  brief: CodingAgentBrief | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const rows = contextRows(context, brief);

  return (
    <>
      <p className="m-0 flex justify-between gap-control-gap tabular-nums">
        <span className="font-luke-semibold">{contextFullLine(context)}</span>
        <span className="text-muted-foreground">{contextTotalLine(context)}</span>
      </p>
      <div
        className="flex h-1.5 gap-list-gap overflow-hidden rounded-luke-full bg-fill-strong"
        aria-hidden="true"
      >
        {rows.map((row) => (
          <span
            key={row.part}
            className={`flex-none ${PART_GROUND[row.part]}`}
            data-part={row.part}
            style={{ width: `${rowWidth(row, context)}%` }}
          />
        ))}
      </div>
      <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ITEM}>
        {rows.map((row) => (
          <li key={row.part} className="flex items-center gap-icon-gap" data-part={row.part}>
            <span
              className={`size-luke-8 flex-none rounded-luke-6 ${PART_GROUND[row.part]}`}
              aria-hidden="true"
            />
            <span className="m-0 min-w-0 flex-1 text-muted-foreground">{row.label}</span>
            <span className="m-0 tabular-nums">{rowCount(row)}</span>
          </li>
        ))}
      </Stack>
      <Facts ruled>
        {contextStats(context, now).map((stat) => (
          <Fact key={stat.label} label={stat.label}>
            {stat.value}
          </Fact>
        ))}
      </Facts>
      <p className="m-0 text-caption-inline text-muted-foreground">
        As of the agent's last step. ~ marks an estimate.
      </p>
    </>
  );
}

function ContextPopover({
  open,
  id,
  context,
  brief,
  onClose,
  onLeave,
}: {
  /** Whether it stands; closed, it fades out. */
  open: boolean;
  id: string;
  context: CodingAgentContext;
  brief: CodingAgentBrief | undefined;
  /** Closes the popover and hands focus back to the ring. */
  onClose: () => void;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  return (
    <PopoverPanel
      open={open}
      id={id}
      title={CONTEXT_LABEL}
      closeLabel="Close"
      onDismiss={onClose}
      onLeave={onLeave}
    >
      <ContextBody context={context} brief={brief} />
    </PopoverPanel>
  );
}

export function AgentContextRing({
  context,
  brief,
  open: heldOpen,
  onOpenChange,
}: {
  /** What the agent's model's context holds, as the transcript's last page said; nothing before a step ended, which draws no ring. */
  context: CodingAgentContext | undefined;
  /** What the agent was handed, which names the brief's row. */
  brief: CodingAgentBrief | undefined;
  /** Whether the popover stands, where the owner holds it, as the composer does so its ⋯ menu can open it; the ring's own otherwise. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}): React.JSX.Element | null {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = heldOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (context === undefined) return null;

  // Note that we hand focus back to the ring, as a menu returns it to its
  // trigger, because closing takes the focused popover away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="agent-context relative flex min-w-0" ref={root}>
      <span className="agent-context-button flex" data-level={contextLevel(context)}>
        <Tooltip label={contextHint(context)}>
          <IconButton
            ref={trigger}
            icon={<ContextRing share={contextShare(context)} level={contextLevel(context)} />}
            label={CONTEXT_LABEL}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            onClick={() => setOpen(!open)}
          />
        </Tooltip>
      </span>
      <AnchoredPopover open={open} align={POPOVER_ALIGN.END}>
        <ContextPopover
          open={open}
          id={popoverId}
          context={context}
          brief={brief}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      </AnchoredPopover>
    </div>
  );
}
