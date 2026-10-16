import type { CodingAgentBrief, CodingAgentContext } from "@luke/features/coding-agent-wire";
import { CloseIcon } from "@luke/ui";
import { useEffect, useId, useRef, useState } from "react";
import { AnchoredPopover, POPOVER_ALIGN } from "../anchored-popover";
import { Tooltip } from "../tooltip";
import {
  contextFullLine,
  contextHint,
  contextLevel,
  contextRows,
  contextShare,
  contextStats,
  contextTotalLine,
  rowCount,
  rowWidth,
} from "./agent-context-model";
import { useMinute } from "./task-time";

/**
 * agent-context.tsx -- the ring at the agent box's foot that shows how full the agent's model's context is, and the popover that says what fills it.
 *
 * Beside the model chip stands a small ring, the way Claude Code and
 * Cursor draw one, filled with the share of the window the agent's newest
 * step read and coloured by how near eve's compaction that is
 * (`agent-context-model.ts`); its hover says the share in words. A press
 * opens a popover right above the ring, the model menu's width, from the
 * ring's trailing edge as the model menu hangs from its chip, since both
 * stand at the foot's right (`../anchored-popover.tsx`). It says the
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

/** The ring itself: a faint track and the share filled over it, from twelve o'clock. */
function ContextRing({ share }: { share: number }): React.JSX.Element {
  const filled = Math.min(1, Math.max(0, share)) * RING_LENGTH;
  return (
    <svg className="agent-context-ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        className="agent-context-track"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeWidth={RING_STROKE}
      />
      <circle
        className="agent-context-fill"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeWidth={RING_STROKE}
        strokeDasharray={`${filled} ${RING_LENGTH}`}
      />
    </svg>
  );
}

function ContextPopover({
  id,
  context,
  brief,
  onClose,
  onLeave,
}: {
  id: string;
  context: CodingAgentContext;
  brief: CodingAgentBrief | undefined;
  /** Closes the popover and hands focus back to the ring. */
  onClose: () => void;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const now = useMinute();
  const rows = contextRows(context, brief);

  // The popover takes focus as it opens, so Escape and focus leaving it are heard.
  useEffect(() => {
    box.current?.focus();
  }, []);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      ref={box}
      id={id}
      className="agent-context-popover"
      role="dialog"
      aria-label={CONTEXT_LABEL}
      tabIndex={-1}
      onKeyDown={onKey}
      onBlur={(event) => onLeave(event.relatedTarget)}
    >
      <div className="agent-context-head">
        <h2 className="agent-context-title">{CONTEXT_LABEL}</h2>
        <Tooltip label="Close">
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </Tooltip>
      </div>
      <p className="agent-context-summary">
        <span className="agent-context-full">{contextFullLine(context)}</span>
        <span className="agent-context-total">{contextTotalLine(context)}</span>
      </p>
      <div className="agent-context-bar" aria-hidden="true">
        {rows.map((row) => (
          <span
            key={row.part}
            className="agent-context-segment"
            data-part={row.part}
            style={{ width: `${rowWidth(row, context)}%` }}
          />
        ))}
      </div>
      <ul className="agent-context-legend">
        {rows.map((row) => (
          <li key={row.part} className="agent-context-row" data-part={row.part}>
            <span className="agent-context-swatch" aria-hidden="true" />
            <span className="agent-context-label">{row.label}</span>
            <span className="agent-context-count">{rowCount(row)}</span>
          </li>
        ))}
      </ul>
      <dl className="agent-context-stats">
        {contextStats(context, now).map((stat) => (
          <div key={stat.label} className="agent-context-row">
            <dt className="agent-context-label">{stat.label}</dt>
            <dd className="agent-context-count">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="agent-context-note">As of the agent's last step. ~ marks an estimate.</p>
    </div>
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
    <div className="agent-context" ref={root}>
      <Tooltip label={contextHint(context)}>
        <button
          ref={trigger}
          type="button"
          className="icon-button agent-context-button"
          aria-label={CONTEXT_LABEL}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          data-level={contextLevel(context)}
          onClick={() => setOpen(!open)}
        >
          <ContextRing share={contextShare(context)} />
        </button>
      </Tooltip>
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.END}>
          <ContextPopover
            id={popoverId}
            context={context}
            brief={brief}
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
