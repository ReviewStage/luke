import type { MemorySummary } from "@luke/features/memory-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW } from "@luke/settings/settings-anchors";
import { TrashIcon } from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act";
import { dayText } from "../planning/plan-time";
import { SpinnerRegion } from "../spinner";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * memory-page.tsx -- Settings › Memory: the facts and conventions Luke kept from the workspace's planning calls, shared by its members, and forgetting one.
 *
 * Luke keeps a memory during a call without asking, and corrects one in
 * place when a call says otherwise. The memory is the workspace's: every
 * member's calls in it recall and keep the same memories, and nothing
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
    `During planning calls in ${workspace.name}, Luke keeps the facts and conventions you settle ` +
    "and recalls them in the workspace's later plans. Everyone in the workspace shares these " +
    "memories. What's said in a call always wins, and Luke corrects a memory it contradicts. " +
    "Forget anything that is wrong or no longer true."
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
    <>
      <MenuRow label="Memory actions" actions={actions}>
        <span className="settings-copy">
          <span className="memory-text">{memory.text}</span>
          <small>{`Kept by ${keeperOf(memory, readerId)} · ${dayText(memory.updatedAt)}`}</small>
        </span>
      </MenuRow>
      <ConfirmDialog
        confirm={forgetting}
        question={{
          title: "Forget this memory?",
          body: "Luke won't recall it in any later plan in this workspace, for anyone.",
          verb: "Forget",
          running: "Forgetting",
        }}
      />
    </>
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

  // The page opening reads the memories as the service holds them now, which a call may just have added to.
  const workspaceId = workspace?.id;
  useEffect(() => {
    if (!signedIn || workspaceId === undefined) return;
    let live = true;
    // Nothing of an earlier read, an earlier account, or another workspace stands while this one is out.
    setMemories(undefined);
    setReadFailed(false);
    act(ACT_KIND.MEMORIES_READ, { workspaceId }).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) setReadFailed(true);
        else setMemories(answer.memories);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, signedIn, workspaceId, attempt]);

  const forget = useCallback(
    (id: string): Promise<ActionResult> => {
      if (workspaceId === undefined) {
        return Promise.resolve({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PAGE_LINE.FORGET_FAILED,
        });
      }
      setForgetting(id);
      return act(ACT_KIND.MEMORIES_FORGET, { workspaceId, id })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          setForgetting(undefined);
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.FORGET_FAILED };
          }
          setMemories(answer.memories);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        });
    },
    [act, workspaceId],
  );

  if (!signedIn) return <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>;
  if (workspace === undefined) return <p className="settings-note">{PAGE_LINE.NO_WORKSPACE}</p>;
  return (
    <>
      <p className="settings-note">{noteFor(workspace)}</p>
      <div className={NO_CAPTURE}>
        <SettingsGroup anchor={SETTINGS_SEARCH_ROW.MEMORY}>
          {memories !== undefined ? (
            memories.length === 0 ? (
              <p className="settings-card-line settings-note">{PAGE_LINE.EMPTY}</p>
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
            <ReadFailed line={PAGE_LINE.FAILED} onRetry={() => setAttempt((count) => count + 1)} />
          ) : (
            <div className="settings-card-line settings-reading">
              <SpinnerRegion label="Loading Luke's memory" />
            </div>
          )}
        </SettingsGroup>
      </div>
    </>
  );
}
