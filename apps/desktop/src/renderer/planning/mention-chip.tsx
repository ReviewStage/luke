import {
  decodeMention,
  encodeMention,
  MENTION_KIND,
  type Mention,
  type PlanMention,
} from "@luke/features/mention-link";
import { DocumentIcon } from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import { FolderIcon, HashIcon } from "lucide-react";
import { CardHead, CardNote, HoverCard } from "../hover-card";
import type { MentionNode } from "../plan-editor/contract";
import { Tooltip } from "../tooltip";
import { FileCard } from "./file-ref";
import { FileTypeIcon } from "./file-type-icon";

/**
 * mention-chip.tsx -- a mention drawn in words as its chip: its kind's glyph and its name, a button that opens what it names, hanging a card that says what that is, struck through where what it names is gone.
 *
 * A mention is written into markdown as a link whose label starts with `@`
 * (`@luke/features/mention-link`), and wherever the words are drawn by a
 * place that can open what a mention names, the link is drawn as this
 * chip: a pill on the words' line, the kind's glyph and the name the
 * mention was written with, cut to the chip's width. A press opens it: a
 * section of a plan, that plan scrolled to the section; a plan, the plan
 * at its top; a file, its tab, through the side panel's one door for a file
 * (`file-ref.tsx`). A folder opens nothing, since the window has no door to
 * one, and is a chip that hangs its card alone, as is a file where the
 * place can open none. Its card, hung while the pointer rests on it, names
 * it whole: a file's is the card every place naming the file hangs.
 *
 * A section is known by its heading, so a section of the plan drawn here
 * whose heading the plan no longer holds is gone: its chip keeps the name
 * it was written with, struck through, its card says it is no longer in
 * the plan, and a press opens the plan at its top. A section of another
 * plan is drawn as found, since what that plan holds is not at hand.
 *
 * Nothing the mention names rides on the chip's element: no attribute
 * carries its target, its plan, its heading, or its path, because only the
 * attributes that carry words are masked when the panel is recorded
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
  readonly onOpenPlan: (mention: PlanMention) => void;
  /** Shows a file's tab; none where no file can be opened from here. */
  readonly onOpenFile: ((path: string) => void) | undefined;
}

/**
 * A mention's target named again where the plan it names had the heading
 * it names renamed in an edit (`../plan-editor/plan-mentions.ts`): the new
 * target, or nothing where the target names no section of the plan, or one
 * of a heading the edit did not rename.
 */
export function retargetedMention(
  planId: string,
  target: string,
  renamed: ReadonlyMap<string, string>,
): string | undefined {
  const mention = decodeMention(target);
  if (mention?.kind !== MENTION_KIND.SECTION || mention.planId !== planId) return undefined;
  const heading = renamed.get(mention.heading);
  return heading === undefined ? undefined : encodeMention({ ...mention, heading });
}

/** What a gone section's card says of it. */
const GONE_WORDS = "No longer in the plan";

/** Whether what the mention names is there to open: a section of this plan is there while the plan holds its heading. */
function mentionState(mention: Mention, doors: MentionDoors): MentionState {
  if (mention.kind !== MENTION_KIND.SECTION || mention.planId !== doors.planId) {
    return MENTION_STATE.FOUND;
  }
  return doors.headings.has(mention.heading) ? MENTION_STATE.FOUND : MENTION_STATE.GONE;
}

/** What a press on the chip does, or nothing where it opens nothing from here. */
function pressOf(
  mention: Mention,
  state: MentionState,
  doors: MentionDoors,
): (() => void) | undefined {
  switch (mention.kind) {
    case MENTION_KIND.FILE: {
      const { onOpenFile } = doors;
      return onOpenFile === undefined ? undefined : () => onOpenFile(mention.path);
    }
    case MENTION_KIND.FOLDER:
      return undefined;
    case MENTION_KIND.PLAN:
      return () => doors.onOpenPlan(mention);
    case MENTION_KIND.SECTION:
      // A gone section opens the plan it was in, at its top.
      return () =>
        doors.onOpenPlan(
          state === MENTION_STATE.FOUND
            ? mention
            : { kind: MENTION_KIND.PLAN, planId: mention.planId },
        );
  }
}

function MentionGlyph({ mention }: { mention: Mention }): React.JSX.Element {
  switch (mention.kind) {
    case MENTION_KIND.SECTION:
      return <HashIcon aria-hidden="true" />;
    case MENTION_KIND.PLAN:
      return <DocumentIcon />;
    case MENTION_KIND.FILE:
      return <FileTypeIcon name={fileName(mention.path)} />;
    case MENTION_KIND.FOLDER:
      return <FolderIcon aria-hidden="true" />;
  }
}

/** The card a chip hangs: a file's own card, or its glyph and whole name, and why it is gone where it is. */
function MentionCard({
  mention,
  name,
  state,
}: {
  mention: Mention;
  name: string;
  state: MentionState;
}): React.JSX.Element {
  if (mention.kind === MENTION_KIND.FILE) return <FileCard path={mention.path} note={undefined} />;
  const whole = mention.kind === MENTION_KIND.FOLDER ? `${mention.path}/` : name;
  return (
    <HoverCard data-mention-card="">
      <CardHead glyph={<MentionGlyph mention={mention} />} name={whole} />
      {state === MENTION_STATE.GONE ? <CardNote>{GONE_WORDS}</CardNote> : null}
    </HoverCard>
  );
}

/** A mention in words: its chip, a button that opens what it names where it can, hanging its card. */
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
  const press = pressOf(mention, state, doors);
  const face = (
    <>
      <span className="mention-chip-glyph">
        <MentionGlyph mention={mention} />
      </span>
      <span className="mention-chip-label">{name}</span>
    </>
  );
  return (
    <Tooltip label={name} card={<MentionCard mention={mention} name={name} state={state} />}>
      {press === undefined ? (
        <span className="mention-chip" data-kind={mention.kind} data-state={state}>
          {face}
        </span>
      ) : (
        <button
          type="button"
          className="mention-chip"
          data-kind={mention.kind}
          data-state={state}
          onClick={(event) => {
            // Note that the press stops here, because a click into a section opens its editor.
            event.stopPropagation();
            press();
          }}
        >
          {face}
        </button>
      )}
    </Tooltip>
  );
}

/** A mention an editor holds, as its node names it: its chip where its target names a mention, and its words where it names none. */
export function MentionNodeChip({
  mention,
  doors,
}: {
  mention: MentionNode;
  doors: MentionDoors;
}): React.JSX.Element {
  const named = decodeMention(mention.target);
  if (named === undefined) return <>{`@${mention.name}`}</>;
  return <MentionChip mention={named} name={mention.name} doors={doors} />;
}
