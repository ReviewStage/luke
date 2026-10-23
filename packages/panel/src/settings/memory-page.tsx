import type { MemorySummary } from "@luke/features/memory-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW } from "@luke/settings/settings-anchors";
import {
  ConfirmDialog,
  ErrorState,
  SettingsLine,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TrashIcon,
  useConfirmDialog,
} from "@luke/ui";
import { dayText } from "@luke/ui/time-format";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { MenuRow } from "./menu-row.js";

/**
 * memory-page.tsx -- Settings › Memory: the facts and conventions the workspace's coding agents kept, shared by its members, and forgetting one.
 *
 * A coding agent keeps a memory as it works without asking, and corrects one
 * in place when its developer says otherwise. The memory is the workspace's: every
 * member's agents in it recall and keep the same memories, and nothing
 * crosses into another workspace. So this page shows the memories of the
 * workspace Settings shows, the one the sidebar lists, and is where a
 * member sees what was kept and takes back what is wrong or no longer true.
 * A note says what the memories are for and who shares them, then one row
 * per memory, most recently kept first, with whose words it holds and when
 * it was last kept, and Forget behind the row's ⋯ and a right-click where
 * the reader may forget it: its words are theirs, or they own or administer
 * the workspace. Forget asks first, in the confirm dialog, and removes the
 * memory for good: no later call recalls it. One forget runs at a time,
 * since every answer is the workspace's memories whole and two in flight
 * could land out of order. The whole page is kept out of the screen
 * recording, since a memory is members' own words about their work.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: "Luke's memory could not be read.",
  SIGNED_OUT: "Sign in to see what Luke remembers.",
  NO_WORKSPACE: "Luke's memory belongs to a workspace, and none is open yet.",
  EMPTY: "Luke hasn't remembered anything yet.",
  FORGET_FAILED: "The memory could not be forgotten. Try again.",
} as const;

/** What the page says the memories are for, and who shares them. */
function noteFor(workspace: Workspace): string {
  return (
    `As they work in ${workspace.name}, Luke's coding agents keep the facts and conventions ` +
    "you settle and recall them in the workspace's later tasks. Everyone in the workspace " +
    "shares these memories. What you say now always wins, and an agent corrects a memory it " +
    "contradicts. Forget anything that is wrong or no longer true."
  );
}

/** Whose words a memory holds, as the reader is told: You for their own. */
function keeperOf(memory: MemorySummary, readerId: string | undefined): string {
  const { keptBy } = memory;
  if (keptBy === null || keptBy.name === "") return "a former member";
  return keptBy.userId === readerId ? "You" : keptBy.name;
}

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** One memory's row: its words, when it was last kept, and Forget behind its ⋯. */
function MemoryRow({
  memory,
  readerId,
  locked,
  onForget,
}: {
  memory: MemorySummary;
  readerId: string | undefined;
  /** Whether another row's forget is in flight, which this row waits out. */
  locked: boolean;
  onForget: (id: string) => Promise<ActionResult>;
}): React.JSX.Element {
  const forgetting = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    onForget(memory.id),
  );
  // Note that a memory the reader may not forget offers no ⋯ at all, because a Forget the service would refuse is no act.
  const actions = memory.forgettable
    ? [
        {
          label: "Forget",
          icon: <TrashIcon />,
          danger: true,
          disabled: forgetting.busy || locked,
          onSelect: forgetting.ask,
        },
      ]
    : [];

  return (
    <div className="memory-row">
      <MenuRow
        label="Memory actions"
        actions={actions}
        row={{
          label: <span className="memory-text">{memory.text}</span>,
          description: `Kept by ${keeperOf(memory, readerId)} · ${dayText(memory.updatedAt)}`,
        }}
      />
      <ConfirmDialog
        confirm={forgetting}
        question={{
          title: "Forget this memory?",
          body: "No agent will recall it in any later task in this workspace, for anyone.",
          verb: "Forget",
          running: "Forgetting…",
        }}
      />
    </div>
  );
}

export function MemorySection({
  signedIn,
  workspace,
  readerId,
}: {
  signedIn: boolean;
  /** The workspace Settings shows, whose memories the page reads; absent before the workspaces are read. */
  workspace: Workspace | undefined;
  /** The signed-in account, whose own memories read as You. */
  readerId: string | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const [memories, setMemories] = useState<readonly MemorySummary[] | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [forgetting, setForgetting] = useState<string | undefined>(undefined);
  // Note that every change of workspace or reader starts a new scope, because a forget still out
  // from the one before answers that scope's list, which must never be drawn under this one.
  const scope = useRef(0);
  /** The workspace the page shows now, which a forget answered after the page moved on checks against. */
  const shown = useRef<string | undefined>(undefined);
  // Note that every read and forget is numbered as it is sent, and a list is drawn only when it
  // answers a later request than the list drawn last, so an older answer arriving late never
  // puts back a memory a newer one already forgot.
  const sent = useRef(0);
  const drawn = useRef(0);
  // Note that a read out while a forget landed may have read the list before that forget's delete,
  // so its answer is not drawn; the page reads again instead.
  const forgotten = useRef(0);

  /** Draws the list one request answered, unless a later request's list is drawn already; answers whether it drew. */
  const draw = useCallback((request: number, list: readonly MemorySummary[]): boolean => {
    if (request < drawn.current) return false;
    drawn.current = request;
    setMemories(list);
    return true;
  }, []);

  const workspaceId = workspace?.id;
  useEffect(() => {
    scope.current += 1;
    shown.current = workspaceId;
    setForgetting(undefined);
  }, [signedIn, workspaceId, readerId]);

  // The page opening reads the memories as the service holds them now, which a call may just have added to.
  useEffect(() => {
    if (!signedIn || workspaceId === undefined) return;
    let live = true;
    sent.current += 1;
    const request = sent.current;
    const forgottenBefore = forgotten.current;
    // Nothing of an earlier read, an earlier account, or another workspace stands while this one is out.
    setMemories(undefined);
    setReadFailed(false);
    act(ACT_KIND.MEMORIES_READ, { workspaceId }).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) setReadFailed(true);
        else if (forgotten.current !== forgottenBefore) setAttempt((count) => count + 1);
        else draw(request, answer.memories);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, draw, signedIn, workspaceId, readerId, attempt]);

  const forget = useCallback(
    (id: string): Promise<ActionResult> => {
      if (workspaceId === undefined) {
        return Promise.resolve({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PAGE_LINE.FORGET_FAILED,
        });
      }
      const asked = scope.current;
      sent.current += 1;
      const request = sent.current;
      setForgetting(id);
      return act(ACT_KIND.MEMORIES_FORGET, { workspaceId, id })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (asked === scope.current) setForgetting(undefined);
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.FORGET_FAILED };
          }
          forgotten.current += 1;
          // A forget answered while the page shows another workspace draws nothing there.
          if (shown.current !== workspaceId) return { status: ACTION_RESULT_STATUS.ACCEPTED };
          // Its own scope's list, unless a later one is drawn; otherwise a read again, since the list
          // on the page may predate the forget, and the newest read's answer is the one that stands.
          const drew = asked === scope.current && draw(request, answer.memories);
          if (!drew) setAttempt((count) => count + 1);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        });
    },
    [act, draw, workspaceId],
  );

  if (!signedIn) return <SettingsLine>{PAGE_LINE.SIGNED_OUT}</SettingsLine>;
  if (workspace === undefined) return <SettingsLine>{PAGE_LINE.NO_WORKSPACE}</SettingsLine>;
  return (
    <>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
        {noteFor(workspace)}
      </Text>
      <div className={NO_CAPTURE}>
        <SettingsSection anchor={SETTINGS_SEARCH_ROW.MEMORY}>
          {memories !== undefined ? (
            memories.length === 0 ? (
              <SettingsLine>{PAGE_LINE.EMPTY}</SettingsLine>
            ) : (
              memories.map((memory) => (
                <MemoryRow
                  key={memory.id}
                  memory={memory}
                  readerId={readerId}
                  locked={forgetting !== undefined && forgetting !== memory.id}
                  onForget={forget}
                />
              ))
            )
          ) : readFailed ? (
            <SettingsLine>
              <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
                {PAGE_LINE.FAILED}
              </ErrorState>
            </SettingsLine>
          ) : (
            <SettingsRowsSkeleton label="Loading Luke's memory" rows={3} />
          )}
        </SettingsSection>
      </div>
    </>
  );
}
