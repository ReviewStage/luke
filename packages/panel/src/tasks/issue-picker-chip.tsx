import { useAtom } from "@effect/atom-react";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "@luke/settings/shortcuts";
import { CHIP_LOOK, CHIP_WIDTH, Chip, ChipName, ProviderMark } from "@luke/ui";
import { type LinearIssuesAsk, linearIssuesAskOf, offeredIssues } from "@luke/ui/tasks-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ListTodoIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { rendererRuntime } from "../renderer-runtime.js";
import { type MenuRow, SearchableMenu } from "../searchable-menu.js";
import { PICKER_ALIGN, type PickerAlign, usePickerPlacement } from "../settings/picker-row.js";
import { Tooltip } from "../tooltip.js";
import type { NewTaskIssue, TasksControl } from "./use-tasks-tab.js";

/**
 * issue-picker-chip.tsx -- New task's Issue chip: a press away from one search over the workspace's own issues and, where it has Linear connected, its Linear issues.
 *
 * Drawn where the workspace the task starts in offers either, as an issue
 * glyph, "Issue", and a chevron, the chip opens the app's one searchable
 * menu, hung from its leading edge, or its trailing edge where it ends its
 * row as at the right of the New task dialog's head (`align`), and placed as
 * a Settings picker's is. The menu lists the workspace's own issues under
 * "Issues" and Linear's under "Linear", each heading only where both
 * stand. With nothing typed in the menu's field it lists every issue read as
 * the card opened, as each list came, newest changed first; as soon as
 * anything is typed, the issues of either whose title or key holds every
 * word stand nearest first, and once the typing rests Linear itself is
 * searched for the words, so a Linear issue older than those read is found
 * too; a Linear key typed whole or a link to a Linear issue pasted asks
 * Linear for that one issue instead. ↑ and ↓ move the highlight, Return
 * chooses the highlighted issue, and Escape closes the menu, not the card,
 * handing focus back to what opened it: the chip, or the field whose ⌘L
 * asked for it (`openRequest`). The issues are read as the chip first
 * stands and again for another workspace, which closes the menu. Nothing
 * typed in the menu's field names the task; choosing an issue is the
 * owner's to act on.
 */

/** The chord that opens the menu from the card's own field. */
export const ISSUE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.L };

/** What the chip and its menu say. */
const ISSUE_WORDS = {
  CHIP: "Issue",
  LABEL: "Choose an issue",
  MENU: "Issues",
  OWN: "Issues",
  LINEAR: "Linear",
  SEARCH: "Search issues, or paste a key or link",
  NONE: "No issues found",
} as const;

/** How long the typing rests before Linear is searched for the words as typed. */
const SEARCH_PAUSE = Duration.millis(250);

/**
 * The issues of the workspace the task starts in, its own or its Linear's,
 * read as the card opens and again for another workspace; none while they
 * are read, where the workspace offers none, or where the read was refused.
 */
function useIssuesRead<Issue>(
  readIn: (workspaceId: string | undefined) => (() => Promise<readonly Issue[]>) | undefined,
  workspaceId: string | undefined,
): readonly Issue[] {
  const [issues, setIssues] = useState<readonly Issue[]>([]);
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

/** One Linear issue as a row: its title, then its key and the state it stands in, under Linear's heading where one is drawn. */
function linearRow(issue: LinearIssueSummary, section: string | undefined): MenuRow {
  return {
    id: issue.id,
    label: issue.title,
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />,
    detail: issue.state === undefined ? issue.identifier : `${issue.identifier} · ${issue.state}`,
    section,
  };
}

/** One of the workspace's own issues as a row: its title, then its key, under the Issues heading where one is drawn. */
function ownRow(issue: NewTaskIssue, section: string | undefined): MenuRow {
  return {
    id: issue.id,
    label: issue.title,
    icon: <ListTodoIcon />,
    detail: issue.identifier,
    section,
  };
}

export function IssuePickerChip({
  linearIn,
  issuesIn,
  workspaceId,
  disabled,
  openRequest,
  align = PICKER_ALIGN.START,
  onChoose,
  onChooseOwn,
}: {
  /** The read of a workspace's Linear issues, none where it has no Linear connected (`TasksControl`'s). */
  linearIn: TasksControl["newTask"]["linearIssuesIn"];
  /** The read of a workspace's own issues, none where Issues are not on (`TasksControl`'s). */
  issuesIn: TasksControl["newTask"]["issuesIn"];
  /** The workspace the task starts in, whose issues are listed. */
  workspaceId: string | undefined;
  disabled: boolean;
  /** Counts the asks from elsewhere to open the menu, such as the field's ⌘L, each opening it. */
  openRequest?: number | undefined;
  /** Which of the chip's edges its menu hangs from: the leading one, or the trailing one where the chip ends its row. */
  align?: PickerAlign | undefined;
  onChoose: (issue: LinearIssueSummary) => void;
  onChooseOwn: (issue: NewTaskIssue) => void;
}): React.JSX.Element | null {
  const linear = linearIn(workspaceId) !== undefined;
  const own = issuesIn(workspaceId) !== undefined;
  const connected = linear || own;
  const issues = useIssuesRead(linearIn, workspaceId);
  const ownIssues = useIssuesRead(issuesIn, workspaceId);
  const [searched, searchLinear] = useLinearSearch(linearIn);
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
  // Every source of issues let go while the menu stood closes it too, so
  // one coming back draws nothing until the chip is pressed again.
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

  const listed = linear ? listedIssues(issues, searched, workspaceId, typed) : [];
  const ownListed = typed.trim() === "" ? ownIssues : offeredIssues(ownIssues, typed);
  // Note that each kind stands under its heading only where both may be listed.
  const both = linear && own;
  const rows = [
    ...ownListed.map((issue) => ownRow(issue, both ? ISSUE_WORDS.OWN : undefined)),
    ...listed.map((issue) => linearRow(issue, both ? ISSUE_WORDS.LINEAR : undefined)),
  ];
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
    <div className="issue-picker-chip" data-align={align} {...placement} ref={box}>
      <Tooltip label={ISSUE_WORDS.LABEL} chord={ISSUE_CHORD}>
        <Chip
          ref={trigger}
          look={CHIP_LOOK.FIELD}
          width={CHIP_WIDTH.AUTO}
          chevron
          aria-label={ISSUE_WORDS.LABEL}
          aria-keyshortcuts={shortcutAria(ISSUE_CHORD)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={disabled}
          onClick={press}
        >
          <ListTodoIcon />
          <ChipName>{ISSUE_WORDS.CHIP}</ChipName>
        </Chip>
      </Tooltip>
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={ISSUE_WORDS.MENU}
          placeholder={ISSUE_WORDS.SEARCH}
          rows={rows}
          value={undefined}
          noMatch={ISSUE_WORDS.NONE}
          onSearch={(words) => {
            setTyped(words);
            searchLinear(words, workspaceId);
          }}
          onPick={(id) => {
            const mine = ownListed.find((each) => each.id === id);
            const issue = listed.find((each) => each.id === id);
            close();
            if (mine !== undefined) onChooseOwn(mine);
            else if (issue !== undefined) onChoose(issue);
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
