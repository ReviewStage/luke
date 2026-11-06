import type { AgentBrief, AgentContext } from "@repo/features/agent-wire";
import {
  AnchoredPopover,
  Fact,
  Facts,
  GAP,
  IconButton,
  LAYOUT_ELEMENT,
  POPOVER_ALIGN,
  PopoverPanel,
  PROGRESS_RING_TONE,
  ProgressRing,
  type ProgressRingTone,
  Stack,
  Tooltip,
  useMinute,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
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

const CONTEXT_LABEL = "Context usage";

const LEVEL_TONE = {
  [CONTEXT_LEVEL.ROOM]: PROGRESS_RING_TONE.MUTED,
  [CONTEXT_LEVEL.NEAR]: PROGRESS_RING_TONE.ATTENTION,
  [CONTEXT_LEVEL.OVER]: PROGRESS_RING_TONE.DANGER,
} as const satisfies Record<ContextLevel, ProgressRingTone>;

const PART_GROUND = {
  [CONTEXT_PART.SYSTEM_PROMPT]: "bg-chart-2",
  [CONTEXT_PART.TOOL_DEFINITIONS]: "bg-chart-1",
  [CONTEXT_PART.BRIEF]: "bg-chart-3",
  [CONTEXT_PART.CONVERSATION]: "bg-muted-foreground",
} as const satisfies Record<ContextPart, string>;

export function ContextRingIcon({ context }: { context: AgentContext }): React.JSX.Element {
  return <ProgressRing share={contextShare(context)} tone={LEVEL_TONE[contextLevel(context)]} />;
}

function ContextBody({
  context,
  brief,
}: {
  context: AgentContext;
  brief: AgentBrief | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const rows = contextRows(context, brief);

  return (
    <>
      <p className="m-0 flex justify-between gap-control-gap tabular-nums">
        <span className="font-ui-semibold">{contextFullLine(context)}</span>
        <span className="text-muted-foreground">{contextTotalLine(context)}</span>
      </p>
      <div
        className="flex h-1.5 gap-list-gap overflow-hidden rounded-ui-full bg-fill-strong"
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
              className={`size-ui-8 flex-none rounded-ui-6 ${PART_GROUND[row.part]}`}
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
  open: boolean;
  id: string;
  context: AgentContext;
  brief: AgentBrief | undefined;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  return (
    <PopoverPanel
      open={open}
      id={id}
      title={CONTEXT_LABEL}
      replayUnmasked
      closeLabel="Close"
      onDismiss={onClose}
      onLeave={onLeave}
    >
      <ReplayUnmask>
        <ContextBody context={context} brief={brief} />
      </ReplayUnmask>
    </PopoverPanel>
  );
}

export function AgentContextRing({
  context,
  brief,
  open: heldOpen,
  onOpenChange,
}: {
  context: AgentContext | undefined;
  brief: AgentBrief | undefined;
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
            icon={<ContextRingIcon context={context} />}
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
