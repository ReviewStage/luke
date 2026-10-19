import type { CodingAgentAttachment, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  riseAboveEnd,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  Text,
  TextButton,
  useMenu,
} from "@luke/ui";
import { ACTOR_KIND } from "@luke/ui/actor-model";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { ActorMark } from "../actor-ref.js";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { useAgentArchive } from "../desktop/agent-archive.js";
import { AgentActorRef, type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { CONTINUE_LABEL, CONTINUED_IN } from "./coding-agent-model.js";
import { useContinueDoor } from "./fork-action.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";

/**
 * continue-agent.tsx -- where an agent may be continued in a new one: the press that starts it on the agent's whole transcript, and, once it was, the agents that continued it.
 *
 * The press ends a failed turn's end line, on its row, and the note of a box
 * closed because the agent's session has ended, whose words and files it
 * carries on, so nothing typed is lost. Where the agent's tab opens drafts
 * (`useContinueDoor`), the press opens the task's draft as a continue of
 * the agent, the words and files laid in its box, and lets the closed box's
 * go at once: nothing is sent until the developer sends the draft, an empty
 * one continuing on nothing more. Elsewhere it starts the new agent at
 * once with them as its note, and lets them go once it landed, unless they
 * were changed meanwhile, in another window, when the newer words stay;
 * that press is held busy while it is out, and says beside itself why it
 * did not start. Nothing offers it where no Start could run: on an
 * archived task, or an agent on none.
 *
 * Once any agent continues this one (`continuedByIds`), the agents are
 * named in one place, oldest first, each by its chip, which opens its tab:
 * the note that takes the box's place (`ContinuedComposerNote`), with Stop
 * while a turn still runs and Archive, since a continued agent is done
 * with; or, where the box is taken by an archived task's note, the row at
 * the transcript's end (`ContinuedTrail`). Past three, only the newest two
 * stand as chips, and +N more opens a menu of the rest, so the note stays
 * one line however often the agent was continued. The press stays where
 * it was, on the failed end line's row, saying Continue again, since a
 * continuation may itself fail or go wrong; each press is a continue of
 * its own, under a key of its own (`use-coding-agents.ts`). A fork is no
 * continuation, so a source with only forks keeps its box.
 */

/** How many of the newest continuing agents stand as chips once more than one more would; the rest are under +N more. */
const CONTINUED_CHIPS = 2;

/** What the continued box's note offers, worded once. */
const CONTINUED_COPY = {
  MORE: (count: number) => `+${count} more`,
  EARLIER: "Earlier continuations",
  ARCHIVE: "Archive",
  STOP: "Stop",
  STOPPING: "Stopping",
  CONTINUING: "Continuing in new agent",
} as const;

/** What a closed box hands the press: its words and the files attached to them, and the agent's task, under which they are kept. */
export interface ContinueCarry {
  readonly words: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly taskId: string | null;
}

/** Whether a draft still holds what a press carried: the same words and the same files in order. */
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
  control: Pick<CodingAgentsControl, "continueAgent">;
  /** The closed box's words and files, which the press carries; none for a press that carries nothing. */
  carry?: ContinueCarry | undefined;
  /** Whether the press may stand here, where no other place offers it. */
  offers?: boolean;
  /** What the press says: Continue in new agent, or Continue again once another agent continued this one. */
  label?: string;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  const writer = useDraftWriter();
  const { continueAgent } = control;
  const opensDraft = useContinueDoor();

  const press = () => {
    if (continueAgent === undefined || busy) return;
    // Where the place opens a draft, the words move into the continue's draft, sent once the developer sends it.
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
        // The words went on into the new agent, so the closed box lets them go, where nothing newer stands.
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
    <span className="agent-continue">
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<ArrowRightIcon aria-hidden="true" />}
        busy={busy}
        busyLabel={CONTINUED_COPY.CONTINUING}
        onClick={press}
      >
        {label}
      </Button>
      {note === undefined ? null : (
        <span className="agent-continue-note" role="alert">
          {note.text}
        </span>
      )}
    </span>
  );
}

/** What names the agents that continued another: the control their chips are read from, and the door that opens one's tab. */
interface ContinuedDoors {
  readonly agentIds: readonly string[];
  /** The titles the source's summary gives them (`continuedByTitles`), which name a chip the list does not hold. */
  readonly titles: ReadonlyMap<string, string>;
  readonly control: Pick<
    CodingAgentsControl,
    "agents" | "archived" | "models" | "me" | "pullRequests" | "chatOn"
  >;
  /** Opens an agent's tab; none where nothing opens one, when a chip hangs its card alone. */
  readonly onOpenAgent: ((agentId: string) => void) | undefined;
}

/** An agent the list does not hold, named by the title the source's summary gives it where it gives one. */
function titledSubject(subject: AgentSubject, title: string | undefined): AgentSubject {
  if (subject.agent !== undefined || title === undefined) return subject;
  if (subject.tile.kind !== ACTOR_KIND.AGENT) return subject;
  return { ...subject, name: title, tile: { ...subject.tile, name: title } };
}

/** Names made one apart from another where two continuing agents share one, as a menu tells its items apart by their words. */
function distinctNames(names: readonly string[]): readonly string[] {
  // Note that every name is held taken first, so a suffix never lands on a name another already has.
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

/**
 * Continued in, then each continuing agent's chip, a comma held after each
 * but the last so no gap opens before it. Past one more than
 * `CONTINUED_CHIPS`, the newest of them stand as chips and +N more opens a
 * menu of the earlier ones, oldest first, each by its mark and name and
 * opening its tab.
 */
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
    <span className="agent-continued-in" data-continued="">
      <span>{CONTINUED_IN}</span>
      {chips.map((agentId, index) => (
        <span key={agentId} className="agent-continued-item">
          <AgentActorRef
            subject={subjectOf(agentId)}
            models={control.models}
            onOpen={() => onOpenAgent?.(agentId)}
          />
          {index === chips.length - 1 && !folds ? null : <span aria-hidden="true">,</span>}
        </span>
      ))}
      {folds ? (
        <TextButton
          tone={TEXT_BUTTON_TONE.LINK}
          aria-expanded={trigger["aria-expanded"]}
          onClick={trigger.onClick}
        >
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

/** The row at a transcript's end naming the agents that continued it, led by an arrow as Forked to is by its split. */
export function ContinuedTrail(doors: ContinuedDoors): React.JSX.Element {
  return (
    <p className="agent-continued" data-continued-trail="">
      <ArrowRightIcon aria-hidden="true" />
      <ContinuedIn {...doors} />
    </p>
  );
}

/**
 * The quiet note in a continued agent's box, framed as the box it replaces:
 * Continued in and the agents' chips, then Stop while a turn still runs,
 * and Archive, bordered as a housekeeping press is, which asks first where
 * archiving would stop a turn (`useAgentArchive`) and toasts with Undo once
 * it took. An agent already
 * archived is offered no Archive.
 */
export function ContinuedComposerNote({
  agent,
  doors,
  stop,
  control,
  shown,
}: {
  agent: CodingAgentSummary;
  doors: ContinuedDoors;
  /** Stops the agent, while it has a turn to stop; settles once the service has answered. */
  stop?: (() => Promise<void>) | undefined;
  control: CodingAgentsControl;
  /** Whether the tab is on screen, which the archive's question goes with. */
  shown: boolean;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  const archive = useAgentArchive(agent, control, shown);
  const pressStop = (run: () => Promise<void>) => {
    setStopping(true);
    run().finally(() => setStopping(false));
  };
  return (
    <>
      <div className="agent-composer">
        <div className="continued-composer">
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
                    <Button variant={BUTTON_VARIANT.OUTLINE} onClick={archive.action.onSelect}>
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
        </div>
      </div>
      {archive.dialog}
    </>
  );
}
