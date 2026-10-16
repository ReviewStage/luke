import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { PLAN_ACTOR, type PlanLastEdit, type PlanSectionEdit } from "@luke/features/task-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  activityWords,
  actorName,
  distinctActors,
  type EditAgent,
  type EditReader,
  editActor,
  editCallOwner,
  LUKE_ACTOR,
  latestActivity,
} from "@luke/ui/actor-model";
import type { ReactNode } from "react";
import { ActorRef, LukeCard, PersonCard } from "../actor-ref";
import { useMemberDirectory } from "../member-directory";
import { GLYPH_STATE, type GlyphState } from "../state-glyph";
import { AgentCard, agentSubject, NOTHING_HELD } from "./agent-ref";
import { agentGlyphState, providerOf } from "./coding-agent-model";
import { agoText } from "./task-time";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * edit-ref.tsx -- who wrote a plan's edit, named on their own face wherever the window says it: the "Edited by" line over the plan, each section's byline, and the plan's ⋯ menu.
 *
 * The writer is read through `@luke/ui/actor-model`'s `editActor`, against
 * the workspace's members the plan's directory holds (`member-directory.tsx`),
 * and named as one target that hangs its card. A person's card says what
 * they last did in the plan, and Luke's whose call he wrote on, when, and
 * what he wrote, both read off who last changed each section, which the
 * window already holds. A coding agent found among the plan's agents wears
 * its harness and where its work stands, hangs its tab's card, and opens
 * its tab on a press where the place offers that; one the plan's list does
 * not hold is named alone. Luke's edit on a call names whose call it was
 * too: "your call" for the reader's own, and the teammate on their face.
 */

/** The actor state an agent's tab glyph state stands for. */
const ACTOR_OF_GLYPH = {
  [GLYPH_STATE.WORKING]: ACTOR_STATE.WORKING,
  [GLYPH_STATE.FAILED]: ACTOR_STATE.FAILED,
  [GLYPH_STATE.REST]: ACTOR_STATE.REST,
} as const satisfies Record<GlyphState, ActorState>;

/** The plan's coding agents, among which an agent's edit is found, and what opens one's tab where the place offers it. */
export interface EditAgents {
  readonly control: Pick<
    CodingAgentsControl,
    "agents" | "archived" | "models" | "me" | "pullRequests"
  >;
  readonly onOpen: ((agentId: string) => void) | undefined;
}

/** Who reads a plan's edits, as a place hands them over: the members are the directory's. */
export type TaskReader = Pick<EditReader, "readerId" | "owner">;

/** What a place knows to name a plan's edits: who reads them, who last changed each section, its agents, and the minute it counts from. */
export interface EditPlace {
  readonly reader: EditReader;
  readonly sections: readonly PlanSectionEdit[];
  readonly agents: EditAgents | undefined;
  readonly now: number;
}

/** The agent an edit names, among the plan's agents, archived or not; none where the edit names none or the list holds no such agent. */
function agentOf(
  edit: PlanLastEdit,
  agents: EditAgents | undefined,
): CodingAgentSummary | undefined {
  const { agentId } = edit;
  if (agentId === undefined || agents === undefined) return undefined;
  const { control } = agents;
  return (
    control.agents?.find((each) => each.id === agentId) ??
    control.archived?.find((each) => each.id === agentId)
  );
}

/** Who wrote an edit, an agent wearing the harness and state the plan's list finds it in; nobody for the plan before history. */
function writerOf(edit: PlanLastEdit, place: EditPlace): Actor | undefined {
  const agent = agentOf(edit, place.agents);
  const found: EditAgent | undefined =
    agent === undefined
      ? undefined
      : { provider: providerOf(agent.model), state: ACTOR_OF_GLYPH[agentGlyphState(agent.status)] };
  return editActor(edit, place.reader, found);
}

/** The words for whose call a card's line says Luke wrote on: "your call", "Charles Pan’s call", or "a call". */
function callWords(owner: Actor | undefined): string {
  if (owner === undefined) return "a call";
  return `${actorName(owner, { sentence: true, possessive: true })} call`;
}

/** Luke's card's line: whose call he wrote on, where he did, and how long ago. */
function lukeSub(edit: PlanLastEdit, place: EditPlace): string {
  const ago = agoText(edit.at, place.now);
  if (!edit.duringCall) return ago;
  return `During ${callWords(editCallOwner(edit, place.reader))} · ${ago}`;
}

/** What an actor last did in the plan, in a card's line; none where no section's last change is theirs. */
function latestLine(actor: Actor, place: EditPlace, ago: boolean): string | undefined {
  const activity = latestActivity(place.sections, actor);
  if (activity === undefined) return undefined;
  const words = activityWords(activity);
  return ago ? `${words} · ${agoText(activity.at, place.now)}` : words;
}

/** A person named in a line: their card says what they last did in the plan; someone the window cannot name hangs their own. */
function PersonRef({
  actor,
  place,
  sentence = false,
  possessive = false,
  faceOnly = false,
}: {
  actor: Actor;
  place: EditPlace;
  sentence?: boolean;
  possessive?: boolean;
  faceOnly?: boolean;
}): React.JSX.Element {
  const card =
    actor.kind === ACTOR_KIND.PERSON ? (
      <PersonCard actor={actor} latest={latestLine(actor, place, true)} />
    ) : undefined;
  return (
    <ActorRef
      actor={actor}
      card={card}
      sentence={sentence}
      possessive={possessive}
      faceOnly={faceOnly}
    />
  );
}

/** The writer of an edit as one target in a line, or their face alone; nothing for the plan before history, which nobody wrote. */
function WriterRef({
  edit,
  place,
  sentence,
  faceOnly,
}: {
  edit: PlanLastEdit;
  place: EditPlace;
  sentence: boolean;
  faceOnly: boolean;
}): React.JSX.Element | null {
  const agent = agentOf(edit, place.agents);
  const actor = writerOf(edit, place);
  if (actor === undefined) return null;
  if (actor.kind === ACTOR_KIND.LUKE) {
    const card = (
      <LukeCard sub={lukeSub(edit, place)} latest={latestLine(LUKE_ACTOR, place, false)} />
    );
    return <ActorRef actor={actor} card={card} faceOnly={faceOnly} />;
  }
  if (actor.kind !== ACTOR_KIND.AGENT) {
    return <PersonRef actor={actor} place={place} sentence={sentence} faceOnly={faceOnly} />;
  }
  // An agent the plan's list does not hold is named alone, with no card to read and no tab to open.
  if (agent === undefined || place.agents === undefined) {
    return <ActorRef actor={actor} faceOnly={faceOnly} />;
  }
  const { control, onOpen } = place.agents;
  const subject = agentSubject(control, agent.id, NOTHING_HELD, false);
  return (
    <ActorRef
      actor={{ ...actor, name: subject.name }}
      card={<AgentCard subject={subject} models={control.models} />}
      onOpen={onOpen === undefined ? undefined : () => onOpen(agent.id)}
      faceOnly={faceOnly}
    />
  );
}

/**
 * Whose call Luke wrote an edit on, after his name. Note that the reader's
 * own call and one nobody can be named for are words, since a face there
 * would add no name.
 */
function CallOwner({ edit, place }: { edit: PlanLastEdit; place: EditPlace }): ReactNode {
  const owner = editCallOwner(edit, place.reader);
  if (owner === undefined || (owner.kind === ACTOR_KIND.PERSON && owner.you)) {
    return ` during ${callWords(owner)}`;
  }
  return (
    <>
      {" during "}
      <PersonRef actor={owner} place={place} sentence possessive />
      {" call"}
    </>
  );
}

/** The reader with the members of the directory standing around the caller. */
export function useEditReader(reader: TaskReader): EditReader {
  const { members, former } = useMemberDirectory();
  return { ...reader, members, former };
}

/** Who last wrote each of `edits`, each once, in the order they stand, as a facepile draws them. */
export function editorsOf(edits: readonly PlanLastEdit[], place: EditPlace): readonly Actor[] {
  return distinctActors(edits.flatMap((edit) => writerOf(edit, place) ?? []));
}

/**
 * Who wrote an edit, and on whose call where Luke wrote it on one: "[Luke]
 * Luke during [Charles] Charles Pan’s call", "[Luke] Luke during your call",
 * "[Charles] Charles Pan". `sentence` names the reader "you" inside a line
 * that leads with other words. With `faceOnly` it is the writer's face
 * alone, their name and whose call it was said in the card it hangs and to
 * a screen reader, as words, for a section's byline, which keeps to a
 * heading's end. Drawn inside an
 * `.actor-line`, whose words carry their own spaces. Nothing for the plan
 * before history.
 */
export function EditedBy({
  edit,
  place,
  sentence = false,
  faceOnly = false,
}: {
  edit: PlanLastEdit;
  place: EditPlace;
  sentence?: boolean;
  faceOnly?: boolean;
}): React.JSX.Element | null {
  if (edit.actor === PLAN_ACTOR.EARLIER) return null;
  return (
    <>
      <WriterRef edit={edit} place={place} sentence={sentence} faceOnly={faceOnly} />
      {!edit.duringCall ? null : faceOnly ? (
        <span className="visually-hidden">{` during ${callWords(editCallOwner(edit, place.reader))}`}</span>
      ) : (
        <CallOwner edit={edit} place={place} />
      )}
    </>
  );
}
