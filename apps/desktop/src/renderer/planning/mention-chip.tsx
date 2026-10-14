import { MENTION_KIND, type Mention } from "@sidecar/hosted/mention-link";
import { DocumentIcon } from "@sidecar/panel";
import { HashIcon } from "lucide-react";
import { CardDetail } from "../desktop/plan-card";
import { Tooltip } from "../tooltip";

/**
 * mention-chip.tsx -- a mention drawn in words as its chip: its kind's glyph and its name, a button that opens what it names, hanging a card that says what that is, struck through where what it names is gone.
 *
 * A mention is written into markdown as a link whose label starts with `@`
 * (`@sidecar/hosted/mention-link`), and wherever the words are drawn by a
 * place that can open what a mention names, the link is drawn as this
 * chip: a pill on the words' line, the kind's glyph and the name the
 * mention was written with, cut to the chip's width. A press opens it: a
 * section of a plan, that plan scrolled to the section, and a plan, the
 * plan at its top. Its card, hung while the pointer rests on it, names it
 * whole and says where a press goes.
 *
 * A section is known by its heading, so a section of the plan drawn here
 * whose heading the plan no longer holds is gone: its chip keeps the name
 * it was written with, struck through, its card says it is no longer in
 * the plan, and a press opens the plan at its top. A section of another
 * plan is drawn as found, since what that plan holds is not at hand.
 *
 * Nothing the mention names rides on the chip's element: no attribute
 * carries its target, its plan, or its heading, because only the attributes
 * that carry words are masked when the panel is recorded
 * (`../session-replay.ts`), and a `data-` attribute is not one of them.
 * The chip's words are a text node, which the recording masks.
 */

/** Where a mention's chip stands: what it names is there, or the plan no longer holds it. */
const MENTION_STATE = {
  FOUND: "found",
  GONE: "gone",
} as const;

type MentionState = (typeof MENTION_STATE)[keyof typeof MENTION_STATE];

/** What a place drawing mentions knows and does: the plan it draws and its headings, and what opening a mention does. */
export interface MentionDoors {
  readonly planId: string;
  readonly headings: ReadonlySet<string>;
  readonly onOpen: (mention: Mention) => void;
}

/** What a gone section's card says of it. */
const GONE_WORDS = "No longer in the plan";

/** What a press on a chip opens, said on its card's line. */
const OPEN_WORDS = {
  SECTION: "Open the section",
  PLAN: "Open the plan",
} as const;

/** Whether what the mention names is there to open: a section of this plan is there while the plan holds its heading. */
function mentionState(mention: Mention, doors: MentionDoors): MentionState {
  if (mention.kind !== MENTION_KIND.SECTION || mention.planId !== doors.planId) {
    return MENTION_STATE.FOUND;
  }
  return doors.headings.has(mention.heading) ? MENTION_STATE.FOUND : MENTION_STATE.GONE;
}

/** What a press opens: what the mention names where it is there, else the plan it was in, at its top. */
function opened(mention: Mention, state: MentionState): Mention {
  if (state === MENTION_STATE.FOUND) return mention;
  return { kind: MENTION_KIND.PLAN, planId: mention.planId };
}

function MentionGlyph({ mention }: { mention: Mention }): React.JSX.Element {
  return mention.kind === MENTION_KIND.SECTION ? <HashIcon aria-hidden="true" /> : <DocumentIcon />;
}

/** The card a chip hangs: its glyph and its whole name, why it is gone where it is, and the line a press opens. */
function MentionCard({
  mention,
  name,
  state,
  onOpen,
}: {
  mention: Mention;
  name: string;
  state: MentionState;
  onOpen: () => void;
}): React.JSX.Element {
  const section = mention.kind === MENTION_KIND.SECTION && state === MENTION_STATE.FOUND;
  return (
    <div className="plan-card" data-mention-card="">
      <div className="plan-card-heading">
        <div className="plan-card-head">
          <span className="plan-card-glyph">
            <MentionGlyph mention={mention} />
          </span>
          <span className="plan-card-name">{name}</span>
        </div>
        {state === MENTION_STATE.GONE ? <p className="plan-card-note">{GONE_WORDS}</p> : null}
        <CardDetail
          glyph={<DocumentIcon />}
          label={section ? OPEN_WORDS.SECTION : OPEN_WORDS.PLAN}
          onPress={onOpen}
        />
      </div>
    </div>
  );
}

/** A mention in words: its chip, a button that opens what it names, hanging its card. */
export function MentionChip({
  mention,
  name,
  doors,
}: {
  mention: Mention;
  /** The name it was written with, without its `@`. */
  name: string;
  doors: MentionDoors;
}): React.JSX.Element {
  const state = mentionState(mention, doors);
  const open = () => doors.onOpen(opened(mention, state));
  return (
    <Tooltip
      label={name}
      card={<MentionCard mention={mention} name={name} state={state} onOpen={open} />}
    >
      <button
        type="button"
        className="mention-chip"
        data-kind={mention.kind}
        data-state={state}
        onClick={(event) => {
          // Note that the press stops here, because a click into a section opens its editor.
          event.stopPropagation();
          open();
        }}
      >
        <span className="mention-chip-glyph">
          <MentionGlyph mention={mention} />
        </span>
        <span className="mention-chip-label">{name}</span>
      </button>
    </Tooltip>
  );
}
