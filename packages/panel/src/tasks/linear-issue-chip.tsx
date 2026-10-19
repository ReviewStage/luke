import { useAtom } from "@effect/atom-react";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "@luke/settings/shortcuts";
import { CHIP_LOOK, CHIP_WIDTH, Chip, ChipName, ProviderMark } from "@luke/ui";
import { type LinearIssuesAsk, linearIssuesAskOf, offeredIssues } from "@luke/ui/tasks-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useId, useRef, useState } from "react";
import { rendererRuntime } from "../renderer-runtime.js";
import { type MenuRow, SearchableMenu } from "../searchable-menu.js";
import { PICKER_ALIGN, type PickerAlign, usePickerPlacement } from "../settings/picker-row.js";
import { Tooltip } from "../tooltip.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * linear-issue-chip.tsx -- New task's Linear chip: a press away from a search over the Linear issues of the workspace the task starts in.
 *
 * Drawn only where that workspace has Linear connected, as Linear's mark
 * and its name, the chip opens the app's one searchable menu, hung from its
 * leading edge, or its trailing edge where it ends its row as at the right of
 * the New task dialog's head (`align`), and placed as a Settings picker's
 * is. With nothing typed in
 * the menu's field it lists the issues read as the card opened, as Linear
 * listed them, newest changed first; as soon as anything is typed, the
 * issues whose title or key holds every word stand nearest first, and once
 * the typing rests Linear itself is searched for the words, so an issue
 * older than those read is found too; a key typed whole or a link to an
 * issue pasted asks Linear for that one issue instead. ↑ and ↓ move the
 * highlight, Return chooses the highlighted issue, and Escape closes the
 * menu, not the card, handing focus back to what opened it: the chip, or the
 * field whose ⌘L asked for it (`openRequest`). The issues are read as the
 * chip first stands and again for another workspace, which closes the menu.
 * Nothing typed in the menu's field names the task; choosing an issue is
 * the owner's to act on.
 */

/** The chord that opens the menu from the card's own field. */
export const LINEAR_CHORD: ShortcutChord = { key: SHORTCUT_KEY.L };

/** What the chip and its menu say. */
const LINEAR_WORDS = {
  CHIP: "Linear",
  LABEL: "Choose from Linear",
  MENU: "Linear issues",
  SEARCH: "Search issues, or paste a key or link",
  NONE: "No issues found",
} as const;

/** How long the typing rests before Linear is searched for the words as typed. */
const SEARCH_PAUSE = Duration.millis(250);

/**
 * The Linear issues of the workspace the task starts in, read as the card
 * opens and again for another workspace; none while they are read, where
 * that workspace has no Linear connected, or where the read was refused.
 */
function useLinearIssues(
  readIn: TasksControl["newTask"]["linearIssuesIn"],
  workspaceId: string | undefined,
): readonly LinearIssueSummary[] {
  const [issues, setIssues] = useState<readonly LinearIssueSummary[]>([]);
  // Note that the reader is held through a ref, because the tab hands a new
  // one on every render and a read is owed to a workspace, not a render.
  const latest = useRef(readIn);
  latest.current = readIn;
  const connected = readIn(workspaceId) !== undefined;
  useEffect(() => {
    setIssues([]);
    const reading = connected ? latest.current(workspaceId) : undefined;
    if (reading === undefined) return;
    let current = true;
    reading().then(
      (listed) => {
        if (current) setIssues(listed);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [connected, workspaceId]);
  return issues;
}

/** One search of a workspace's Linear for the words as typed, and the read that asks it. */
interface IssueSearch {
  readonly workspaceId: string | undefined;
  readonly typed: string;
  readonly ask: LinearIssuesAsk;
  readonly read: (ask: LinearIssuesAsk) => Promise<readonly LinearIssueSummary[]>;
}

/** What one search found, and the workspace and the words it was for. */
interface IssueSearchAnswer {
  readonly workspaceId: string | undefined;
  readonly typed: string;
  readonly issues: readonly LinearIssueSummary[];
}

/**
 * A search once the typing has rested, as an atom whose work is the wait and
 * then the read: setting it again starts the wait over and lets go of the
 * read still out, so only the newest words are answered. A refused read
 * finds nothing.
 */
const issueSearchAtom = () =>
  rendererRuntime.fn((search: IssueSearch) =>
    Effect.gen(function* () {
      yield* Effect.sleep(SEARCH_PAUSE);
      const issues = yield* Effect.tryPromise(() => search.read(search.ask)).pipe(
        Effect.orElseSucceed((): readonly LinearIssueSummary[] => []),
      );
      return { workspaceId: search.workspaceId, typed: search.typed, issues };
    }),
  );

/**
 * Linear searched for the words as typed in the workspace given, once the
 * typing rests: the last answer, whichever words and workspace it was for,
 * and the search to ask as the words or the workspace change.
 */
function useLinearSearch(
  readIn: TasksControl["newTask"]["linearIssuesIn"],
): readonly [
  IssueSearchAnswer | undefined,
  (typed: string, workspaceId: string | undefined) => void,
] {
  const [atom] = useState(issueSearchAtom);
  const [answer, search] = useAtom(atom);
  const ask = (typed: string, workspaceId: string | undefined) => {
    const read = readIn(workspaceId);
    const asked = linearIssuesAskOf(typed);
    if (read === undefined || asked === undefined) return;
    search({ workspaceId, typed: typed.trim(), ask: asked, read });
  };
  return [AsyncResult.isSuccess(answer) ? answer.value : undefined, ask];
}

/**
 * The issues the menu lists for the words typed so far: every issue read
 * while nothing is typed; else those read that hold the words and what
 * Linear found for them, nearest first. What Linear found for the words as
 * they now stand is offered whatever it holds; what it found for earlier
 * words stands with the issues read, offered only where it holds the words,
 * until the newer search answers.
 */
function listedIssues(
  issues: readonly LinearIssueSummary[],
  searched: IssueSearchAnswer | undefined,
  workspaceId: string | undefined,
  typed: string,
): readonly LinearIssueSummary[] {
  if (typed.trim() === "") return issues;
  const answered = searched?.workspaceId === workspaceId ? searched : undefined;
  const current = answered !== undefined && answered.typed === typed.trim();
  const found = current ? answered.issues : [];
  const known = current || answered === undefined ? issues : [...issues, ...answered.issues];
  return offeredIssues(known, typed, found);
}

/** One issue as a row: its title, then its key and the state it stands in. */
function issueRow(issue: LinearIssueSummary): MenuRow {
  return {
    id: issue.id,
    label: issue.title,
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />,
    detail: issue.state === undefined ? issue.identifier : `${issue.identifier} · ${issue.state}`,
  };
}

export function LinearIssueChip({
  readIn,
  workspaceId,
  disabled,
  openRequest,
  align = PICKER_ALIGN.START,
  onChoose,
}: {
  /** The read of a workspace's Linear issues, none where it has no Linear connected (`TasksControl`'s). */
  readIn: TasksControl["newTask"]["linearIssuesIn"];
  /** The workspace the task starts in, whose issues are listed. */
  workspaceId: string | undefined;
  disabled: boolean;
  /** Counts the asks from elsewhere to open the menu, such as the field's ⌘L, each opening it. */
  openRequest?: number | undefined;
  /** Which of the chip's edges its menu hangs from: the leading one, or the trailing one where the chip ends its row. */
  align?: PickerAlign | undefined;
  onChoose: (issue: LinearIssueSummary) => void;
}): React.JSX.Element | null {
  const connected = readIn(workspaceId) !== undefined;
  const issues = useLinearIssues(readIn, workspaceId);
  const [searched, searchLinear] = useLinearSearch(readIn);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const placement = usePickerPlacement(open, trigger, align);
  /** What held focus as the menu opened, which closing hands it back to. */
  const opener = useRef<HTMLElement | null>(null);
  // A switch of workspace closes the menu, in the render that brings it,
  // since what it listed and what was typed in it were the other's.
  const [listedFor, setListedFor] = useState(workspaceId);
  if (listedFor !== workspaceId) {
    setListedFor(workspaceId);
    setOpen(false);
    setTyped("");
  }
  // Linear let go while the menu stood closes it too, so its coming back
  // draws nothing until the chip is pressed again.
  if (!connected && open) {
    setOpen(false);
    setTyped("");
  }

  // Note that whether the menu stands is read through a ref, because an ask
  // is owed to its count alone and one made while it stands changes nothing.
  const standing = useRef(open);
  standing.current = open;

  // Each ask from elsewhere opens the menu afresh.
  useEffect(() => {
    if (openRequest === undefined || openRequest === 0 || standing.current) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTyped("");
    setOpen(true);
  }, [openRequest]);

  if (!connected) return null;

  const listed = listedIssues(issues, searched, workspaceId, typed);
  // Note that we hand focus back to where it came from, the chip or the
  // field, as a native menu returns it to its trigger, because closing takes
  // the focused search away with it.
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const press = () => {
    opener.current = trigger.current;
    setTyped("");
    setOpen(!open);
  };

  return (
    <div className="linear-issue-chip" data-align={align} {...placement} ref={box}>
      <Tooltip label={LINEAR_WORDS.LABEL} chord={LINEAR_CHORD}>
        <Chip
          ref={trigger}
          look={CHIP_LOOK.FIELD}
          width={CHIP_WIDTH.AUTO}
          aria-label={LINEAR_WORDS.LABEL}
          aria-keyshortcuts={shortcutAria(LINEAR_CHORD)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={disabled}
          onClick={press}
        >
          <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />
          <ChipName>{LINEAR_WORDS.CHIP}</ChipName>
        </Chip>
      </Tooltip>
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={LINEAR_WORDS.MENU}
          placeholder={LINEAR_WORDS.SEARCH}
          rows={listed.map(issueRow)}
          value={undefined}
          noMatch={LINEAR_WORDS.NONE}
          onSearch={(words) => {
            setTyped(words);
            searchLinear(words, workspaceId);
          }}
          onPick={(id) => {
            const issue = listed.find((each) => each.id === id);
            close();
            if (issue !== undefined) onChoose(issue);
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && box.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
