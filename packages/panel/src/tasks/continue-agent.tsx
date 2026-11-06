import type { AgentAttachment, AgentSummary } from "@repo/features/agent-wire";
import type { Failure } from "@repo/features/failure-remedy";
import {
  ANNOUNCE,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  ComposerFrame,
  NOTE_LINE_LOOK,
  NoteLine,
  riseAboveEnd,
  TEXT_TONE,
  Text,
  TextButton,
  useMenu,
} from "@repo/ui";
import { ACTOR_KIND } from "@repo/ui/actor-model";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { ActorMark } from "../actor-ref.js";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { useAgentArchive } from "../desktop/agent-archive.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import { CONTINUE_LABEL, CONTINUED_IN } from "./agent-model.js";
import { AgentActorRef, type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { useContinueDoor } from "./fork-action.js";
import type { AgentsControl } from "./use-agents.js";

const CONTINUED_CHIPS = 2;

const CONTINUED_COPY = {
  MORE: (count: number) => `+${count} more`,
  EARLIER: "Earlier continuations",
  ARCHIVE: "Archive",
  ARCHIVING: "Archiving",
  STOP: "Stop",
  STOPPING: "Stopping",
  CONTINUING: "Continuing in new agent",
} as const;

export interface ContinueCarry {
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
  readonly taskId: string | null;
}

function holdsCarried(draft: Draft, carry: ContinueCarry): boolean {
  return (
    draft.text === carry.words &&
    draft.attachments.length === carry.attachments.length &&
    draft.attachments.every((file, index) => file === carry.attachments[index])
  );
}

export function ContinueAgent({
  agentId,
  control,
  carry,
  offers = true,
  label = CONTINUE_LABEL,
}: {
  agentId: string;
  control: Pick<AgentsControl, "continueAgent">;
  carry?: ContinueCarry | undefined;
  offers?: boolean;
  label?: string;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  const writer = useDraftWriter();
  const { continueAgent } = control;
  const opensDraft = useContinueDoor();
  useAnnounceShown(ANNOUNCE.ALERT, note?.text ?? "");

  const press = () => {
    if (continueAgent === undefined || busy) return;
    if (opensDraft !== undefined) {
      opensDraft(carry?.words ?? "", carry?.attachments ?? []);
      if (carry !== undefined) {
        writer.update({ kind: DRAFT_PLACE.AGENT, planId: carry.taskId, agentId }, (now) =>
          holdsCarried(now, carry) ? EMPTY_DRAFT : now,
        );
      }
      return;
    }
    const words = carry?.words.trim() ?? "";
    setBusy(true);
    setNote(undefined);
    void continueAgent(agentId, words === "" ? undefined : words, carry?.attachments ?? []).then(
      (failed) => {
        setBusy(false);
        setNote(failed);
        if (failed === undefined && carry !== undefined) {
          writer.update({ kind: DRAFT_PLACE.AGENT, planId: carry.taskId, agentId }, (now) =>
            holdsCarried(now, carry) ? EMPTY_DRAFT : now,
          );
        }
      },
    );
  };

  if (!offers || continueAgent === undefined) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-control-gap gap-y-tight-gap">
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<ArrowRightIcon aria-hidden="true" />}
        busy={busy}
        busyLabel={CONTINUED_COPY.CONTINUING}
        onClick={press}
      >
        {label}
      </Button>
      {note === undefined ? null : <span className="text-danger">{note.text}</span>}
    </span>
  );
}

interface ContinuedDoors {
  readonly agentIds: readonly string[];
  readonly titles: ReadonlyMap<string, string>;
  readonly control: Pick<AgentsControl, "agents" | "archived" | "models" | "me" | "pullRequests">;
  readonly onOpenAgent: ((agentId: string) => void) | undefined;
}

function titledSubject(subject: AgentSubject, title: string | undefined): AgentSubject {
  if (subject.agent !== undefined || title === undefined) return subject;
  if (subject.tile.kind !== ACTOR_KIND.AGENT) return subject;
  return { ...subject, name: title, tile: { ...subject.tile, name: title } };
}

function distinctNames(names: readonly string[]): readonly string[] {
  const taken = new Set(names);
  const given = new Set<string>();
  return names.map((name) => {
    let label = name;
    for (let count = 2; given.has(label) || (label !== name && taken.has(label)); count += 1) {
      label = `${name} · ${count}`;
    }
    given.add(label);
    return label;
  });
}

function ContinuedIn({
  agentIds,
  titles,
  control,
  onOpenAgent,
}: ContinuedDoors): React.JSX.Element {
  const menu = useMenu(true);
  const folds = agentIds.length > CONTINUED_CHIPS + 1;
  const earlier = folds ? agentIds.slice(0, agentIds.length - CONTINUED_CHIPS) : [];
  const chips = folds ? agentIds.slice(-CONTINUED_CHIPS) : agentIds;
  const subjectOf = (agentId: string) =>
    titledSubject(agentSubject(control, agentId, NOTHING_HELD, false), titles.get(agentId));
  const names = distinctNames(earlier.map((agentId) => subjectOf(agentId).name));
  const trigger = menu.trigger(riseAboveEnd);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-tight-gap" data-continued="">
      <span>{CONTINUED_IN}</span>
      {chips.map((agentId, index) => (
        <span key={agentId} className="inline-flex min-w-0 items-baseline">
          <AgentActorRef
            subject={subjectOf(agentId)}
            models={control.models}
            onOpen={() => onOpenAgent?.(agentId)}
          />
          {index === chips.length - 1 && !folds ? null : <span aria-hidden="true">,</span>}
        </span>
      ))}
      {folds ? (
        <TextButton aria-expanded={trigger["aria-expanded"]} onClick={trigger.onClick}>
          {CONTINUED_COPY.MORE(earlier.length)}
        </TextButton>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={CONTINUED_COPY.EARLIER}
          menu={menu.drawn}
          groups={[
            earlier.map((agentId, index) => ({
              label: names[index] ?? agentId,
              icon: <ActorMark actor={subjectOf(agentId).tile} />,
              onSelect: () => onOpenAgent?.(agentId),
              disabled: onOpenAgent === undefined,
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </span>
  );
}

export function ContinuedTrail(doors: ContinuedDoors): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<ArrowRightIcon />} data-continued-trail="">
      <ContinuedIn {...doors} />
    </NoteLine>
  );
}

export function ContinuedComposerNote({
  agent,
  doors,
  stop,
  control,
  shown,
}: {
  agent: AgentSummary;
  doors: ContinuedDoors;
  stop?: (() => Promise<boolean>) | undefined;
  control: AgentsControl;
  shown: boolean;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  if (stopping && stop === undefined) setStopping(false);
  const archive = useAgentArchive(agent, control, shown);
  const pressStop = (run: () => Promise<boolean>) => {
    setStopping(true);
    run().then(
      (took) => setStopping(took),
      () => setStopping(false),
    );
  };
  return (
    <>
      <div className={COMPOSER_ROOM_CLASS}>
        <ComposerFrame className="continued-composer py-row-inset pr-row-inset pl-list-inset">
          <Banner
            look={BANNER_LOOK.ROW}
            glyph={<ArrowRightIcon aria-hidden="true" />}
            actions={
              stop === undefined && agent.archivedAt !== undefined ? undefined : (
                <>
                  {stop === undefined ? null : (
                    <Button
                      busy={stopping}
                      busyLabel={CONTINUED_COPY.STOPPING}
                      onClick={() => pressStop(stop)}
                    >
                      {CONTINUED_COPY.STOP}
                    </Button>
                  )}
                  {agent.archivedAt !== undefined ? null : (
                    <Button
                      variant={BUTTON_VARIANT.OUTLINE}
                      busy={archive.reading}
                      busyLabel={CONTINUED_COPY.ARCHIVING}
                      onClick={archive.action.onSelect}
                    >
                      {CONTINUED_COPY.ARCHIVE}
                    </Button>
                  )}
                </>
              )
            }
          >
            <Text tone={TEXT_TONE.MUTED}>
              <ContinuedIn {...doors} />
            </Text>
          </Banner>
        </ComposerFrame>
      </div>
      {archive.dialog}
    </>
  );
}
