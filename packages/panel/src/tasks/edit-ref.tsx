import type { AgentSummary } from "@repo/features/agent-wire";
import {
  DESCRIPTION_ACTOR,
  type DescriptionLastEdit,
  type DescriptionSectionEdit,
} from "@repo/features/task-wire";
import { agoText } from "@repo/features/time-format";
import { useMinute } from "@repo/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  APP_ACTOR,
  activityWords,
  actorName,
  distinctActors,
  type EditAgent,
  type EditReader,
  editActor,
  latestActivity,
} from "@repo/ui/actor-model";
import { useMemo } from "react";
import { ActorRef, AppCard, PersonCard } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { GLYPH_STATE, type GlyphState } from "../state-glyph.js";
import { agentGlyphState, agentName, providerOf } from "./agent-model.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import type { AgentsControl } from "./use-agents.js";

const ACTOR_OF_GLYPH = {
  [GLYPH_STATE.WORKING]: ACTOR_STATE.WORKING,
  [GLYPH_STATE.FAILED]: ACTOR_STATE.FAILED,
  [GLYPH_STATE.REST]: ACTOR_STATE.REST,
} as const satisfies Record<GlyphState, ActorState>;

export interface EditAgents {
  readonly control: Pick<
    AgentsControl,
    "agents" | "archived" | "listed" | "models" | "me" | "pullRequests"
  >;
  readonly onOpen: ((agentId: string) => void) | undefined;
}

export type TaskReader = Pick<EditReader, "readerId">;

export interface EditPlace {
  readonly reader: EditReader;
  readonly sections: readonly DescriptionSectionEdit[];
  readonly agents: EditAgents | undefined;
}

function agentOf(
  edit: DescriptionLastEdit,
  agents: EditAgents | undefined,
): AgentSummary | undefined {
  const { agentId } = edit;
  if (agentId === undefined || agents === undefined) return undefined;
  const { control } = agents;
  return (
    control.agents?.find((each) => each.id === agentId) ??
    control.archived?.find((each) => each.id === agentId)
  );
}

function writerOf(edit: DescriptionLastEdit, place: EditPlace): Actor | undefined {
  const agent = agentOf(edit, place.agents);
  const found: EditAgent | undefined =
    agent === undefined
      ? undefined
      : { provider: providerOf(agent.model), state: ACTOR_OF_GLYPH[agentGlyphState(agent.status)] };
  return editActor(edit, place.reader, found);
}

export interface ConflictWords {
  readonly note: string;
  readonly take: string;
}

const UNNAMED_CONFLICT: ConflictWords = {
  note: "This section changed while you were editing.",
  take: "Use theirs",
};

const OWN_CONFLICT: ConflictWords = {
  note: "You changed this section elsewhere while you were editing.",
  take: "Use the other",
};

export function conflictWords(
  edit: DescriptionLastEdit | undefined,
  place: EditPlace,
): ConflictWords {
  const writer = edit === undefined ? undefined : writerOf(edit, place);
  if (writer === undefined || edit === undefined) return UNNAMED_CONFLICT;
  if (writer.kind === ACTOR_KIND.PERSON && writer.you) return OWN_CONFLICT;
  const agent = agentOf(edit, place.agents);
  const named =
    agent === undefined || writer.kind !== ACTOR_KIND.AGENT
      ? writer
      : { ...writer, name: agentName(agent, place.agents?.control.models) };
  return {
    note: `${actorName(named)} changed this section while you were editing.`,
    take: `Use ${actorName(named, { possessive: true })}`,
  };
}

function latestLine(actor: Actor, place: EditPlace, now: number, ago: boolean): string | undefined {
  const activity = latestActivity(place.sections, actor);
  if (activity === undefined) return undefined;
  const words = activityWords(activity);
  return ago ? `${words} · ${agoText(activity.at, now)}` : words;
}

function PersonRef({
  actor,
  place,
  sentence = false,
  faceOnly = false,
}: {
  actor: Actor;
  place: EditPlace;
  sentence?: boolean;
  faceOnly?: boolean;
}): React.JSX.Element {
  const now = useMinute();
  const card =
    actor.kind === ACTOR_KIND.PERSON ? (
      <PersonCard actor={actor} latest={latestLine(actor, place, now, true)} />
    ) : undefined;
  return <ActorRef actor={actor} card={card} sentence={sentence} faceOnly={faceOnly} />;
}

function WriterRef({
  edit,
  place,
  sentence,
  faceOnly,
}: {
  edit: DescriptionLastEdit;
  place: EditPlace;
  sentence: boolean;
  faceOnly: boolean;
}): React.JSX.Element | null {
  const now = useMinute();
  const agent = agentOf(edit, place.agents);
  const actor = writerOf(edit, place);
  if (actor === undefined) return null;
  if (actor.kind === ACTOR_KIND.APP) {
    const card = (
      <AppCard sub={agoText(edit.at, now)} latest={latestLine(APP_ACTOR, place, now, false)} />
    );
    return <ActorRef actor={actor} card={card} faceOnly={faceOnly} />;
  }
  if (actor.kind !== ACTOR_KIND.AGENT) {
    return <PersonRef actor={actor} place={place} sentence={sentence} faceOnly={faceOnly} />;
  }
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

export function useEditReader(reader: TaskReader): EditReader {
  const { members, former } = useMemberDirectory();
  const { readerId } = reader;
  return useMemo(() => ({ readerId, members, former }), [readerId, members, former]);
}

export function editorsOf(
  edits: readonly DescriptionLastEdit[],
  place: EditPlace,
): readonly Actor[] {
  return distinctActors(edits.flatMap((edit) => writerOf(edit, place) ?? []));
}

export function EditedBy({
  edit,
  place,
  sentence = false,
  faceOnly = false,
}: {
  edit: DescriptionLastEdit;
  place: EditPlace;
  sentence?: boolean;
  faceOnly?: boolean;
}): React.JSX.Element | null {
  if (edit.actor === DESCRIPTION_ACTOR.EARLIER) return null;
  return <WriterRef edit={edit} place={place} sentence={sentence} faceOnly={faceOnly} />;
}
