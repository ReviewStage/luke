import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentReviewOptionsAnswerView,
} from "@luke/features/coding-agent-view";
import type {
  CodingAgentReviewOptions,
  GitHubPerson,
  PullRequestLabel,
  PullRequestReviewTeam,
} from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  type PullRequestAction,
  type PullRequestActionRequest,
  REVIEWER_KIND,
} from "@luke/features/pull-request-write-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  cssCustomProperties,
  dropBelowStart,
  Tooltip,
  useMenu,
} from "@luke/ui";
import type { Actor } from "@luke/ui/actor-model";
import { GLYPH } from "@luke/ui/icons";
import {
  type PendingValues,
  pendingSettled,
  pendingValue,
  pendingWithout,
  type SameValue,
} from "@luke/ui/pending-values";
import { PlusIcon, UsersRoundIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTOR_SIZE, ActorMark, actorCard } from "../actor-ref.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { usePendingNow } from "../pending-clock.js";
import { useNamer } from "./pull-request-people.js";
import type { PullRequestWrites } from "./pull-request-writes.js";

/**
 * pull-request-pickers.tsx -- the header's reviewer and label pickers, as stage-cli's are: two presses side by side after the reviewers, “+ Reviewer” and “+ Label”, each a menu of what may be asked for or put on, what stands now checked.
 *
 * What the pickers offer is the agent's repository's (`review-options`):
 * its collaborators and the teams that reach it, who may be asked for a
 * review, and its labels. It is read once, as a picker first opens, on the
 * Luke GitHub App's token as every read is, and read again only where that
 * read failed, which its menu offers as a Retry in the place of its items.
 * Choosing an item is one change, sent through the tab's own writes
 * (`pull-request-writes.tsx`): asking or no longer asking a review of a
 * user or a team, putting a label on or taking it off. That change is made
 * on GitHub as the member pressing it, on their own sign-in, and is drawn
 * at once, the face or the label from what the repository's read holds,
 * over what the pull request's read holds (`usePullRequestPicks`, over
 * `@luke/ui/pending-values` as a task's chips are), until that read carries
 * it; where GitHub refuses it, it goes back at once and GitHub's refusal
 * stands on the tab's line under the bar. While a change is out, and until
 * the read after it lands, the pickers stand disabled, so a second change
 * never waits behind the first; the picker whose change is out is the one
 * that shows busy, named for what it does. A pull request merged or closed
 * asks no review, so only its labels are offered.
 */

/** The pickers' own words. */
const PICKER_WORDS = {
  REVIEWERS: "Edit reviewers",
  LABELS: "Edit labels",
  REVIEWER: "Reviewer",
  LABEL: "Label",
  REVIEWERS_BUSY: "Updating reviewers",
  LABELS_BUSY: "Updating labels",
  REVIEWERS_MENU: "Request a review",
  LABELS_MENU: "Labels",
  READING: "Reading the repository…",
  FAILED: "The repository could not be read.",
  RETRY: "Retry",
  NO_REVIEWERS: "Nobody else may be asked.",
  NO_LABELS: "This repository has no labels.",
  TEAM: "Team",
} as const;

/** The changes each picker's menu sends, which show its button busy while one is out. */
const REVIEWER_ACTIONS: readonly PullRequestAction[] = [
  PULL_REQUEST_ACTION.REQUEST_REVIEW,
  PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST,
];
const LABEL_ACTIONS: readonly PullRequestAction[] = [
  PULL_REQUEST_ACTION.ADD_LABEL,
  PULL_REQUEST_ACTION.REMOVE_LABEL,
];

/** Where the read of what the pickers offer stands. */
const OPTIONS = {
  UNASKED: "unasked",
  READING: "reading",
  FAILED: "failed",
  LANDED: "landed",
} as const;

type OptionsRead =
  | { readonly kind: typeof OPTIONS.UNASKED | typeof OPTIONS.READING | typeof OPTIONS.FAILED }
  | { readonly kind: typeof OPTIONS.LANDED; readonly value: CodingAgentReviewOptions };

/** What the pickers offer and the door that reads it, as both share it. */
export interface ReviewOptions {
  readonly read: OptionsRead;
  /** Reads it, where it is not read or reading already. */
  readonly ask: () => void;
}

/** The agent's repository's labels, collaborators, and teams, read once, as a picker first asks, and again only after a failure. */
export function useReviewOptions(
  agentId: string,
  readOptions: (agentId: string) => Promise<CodingAgentReviewOptionsAnswerView>,
): ReviewOptions {
  const [held, setHeld] = useState<{ agentId: string; read: OptionsRead }>({
    agentId,
    read: { kind: OPTIONS.UNASKED },
  });
  const read = held.agentId === agentId ? held.read : { kind: OPTIONS.UNASKED };
  const ask = useCallback(() => {
    if (read.kind === OPTIONS.READING || read.kind === OPTIONS.LANDED) return;
    setHeld({ agentId, read: { kind: OPTIONS.READING } });
    void readOptions(agentId)
      .catch(
        (): CodingAgentReviewOptionsAnswerView => ({
          failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
        }),
      )
      .then((answer) =>
        setHeld({
          agentId,
          read:
            "failure" in answer
              ? { kind: OPTIONS.FAILED }
              : { kind: OPTIONS.LANDED, value: answer },
        }),
      );
  }, [agentId, read.kind, readOptions]);
  return { read, ask };
}

/** The one item a menu holds while what it would offer is read, or, where it could not be, Retry, which reads it again and leaves the menu standing for what it finds. */
function standInItem(options: ReviewOptions): MenuAction {
  if (options.read.kind === OPTIONS.FAILED) {
    return {
      label: PICKER_WORDS.RETRY,
      icon: <GLYPH.RETRY aria-hidden="true" />,
      detail: PICKER_WORDS.FAILED,
      stays: true,
      onSelect: options.ask,
    };
  }
  return { label: PICKER_WORDS.READING, disabled: true, onSelect: () => undefined };
}

/** What the pull request's read holds of its reviewers asked and its labels, which the picks are drawn over. */
interface PickedHeld {
  readonly requested: readonly GitHubPerson[];
  readonly requestedTeams?: readonly PullRequestReviewTeam[] | undefined;
  readonly labels?: readonly PullRequestLabel[] | undefined;
}

/** A pick drawn over the read: what it puts on, or null for what it takes off. */
type Picks<T> = PendingValues<string, T | null>;

/** Whether two picks are one as the header draws them: both on, or both off, since the key names what each is. */
const samePick: SameValue<unknown> = (a, b) => (a === null) === (b === null);

const NO_PEOPLE: readonly GitHubPerson[] = [];
const NO_TEAMS: readonly PullRequestReviewTeam[] = [];
const NO_LABELS: readonly PullRequestLabel[] = [];
const loginOf = (person: GitHubPerson) => person.login;
const slugOf = (team: PullRequestReviewTeam) => team.slug;
const nameOf = (label: PullRequestLabel) => label.name;

/** What the read holds of the one `key` names: it, or null where it holds none. */
function heldOf<T>(held: readonly T[], keyOf: (each: T) => string, key: string): T | null {
  return held.find((each) => keyOf(each) === key) ?? null;
}

/** The read's list with each pick drawn in place: one taken off left out, one put on after those the read holds. */
function pickedOver<T>(
  held: readonly T[],
  picks: Picks<T>,
  keyOf: (each: T) => string,
): readonly T[] {
  if (picks.size === 0) return held;
  const kept = held.filter((each) => picks.get(keyOf(each))?.value !== null);
  const added = [...picks.values()].flatMap(({ value }) =>
    value === null || heldOf(held, keyOf, keyOf(value)) !== null ? [] : [value],
  );
  return [...kept, ...added];
}

/**
 * One list's picks over what the read holds of it: the list drawn, and the
 * door that draws a pick at once and answers what lets go of it again.
 * Note that a pick stands until the read carries it, or answers otherwise,
 * or its time runs out (`@luke/ui/pending-values`), so one GitHub took
 * never flickers back while the pull request is read again.
 */
function usePicks<T>(
  held: readonly T[],
  keyOf: (each: T) => string,
): { readonly shown: readonly T[]; readonly draw: (chosen: T, on: boolean) => () => void } {
  const [picks, setPicks] = useState<Picks<T>>(() => new Map());
  const now = usePendingNow(picks.size > 0);
  useEffect(() => {
    setPicks((was) => pendingSettled(was, (key) => heldOf(held, keyOf, key), samePick, now));
  }, [held, keyOf, now]);
  const shown = useMemo(() => pickedOver(held, picks, keyOf), [held, picks, keyOf]);
  const draw = (chosen: T, on: boolean) => {
    const key = keyOf(chosen);
    const asked = pendingValue(
      picks.get(key),
      on ? chosen : null,
      heldOf(held, keyOf, key),
      samePick,
    );
    setPicks((was) => new Map(was).set(key, asked));
    return () => setPicks((was) => pendingWithout(was, key, asked));
  };
  return { shown, draw };
}

/** The pull request's reviewers asked and its labels as the header draws them, each pick drawn over the read, and the doors that pick. */
export interface PullRequestPicks {
  readonly requested: readonly GitHubPerson[];
  readonly requestedTeams: readonly PullRequestReviewTeam[];
  readonly labels: readonly PullRequestLabel[];
  /** Asks a review of a person, or asks it no longer. */
  readonly pickPerson: (person: GitHubPerson, on: boolean) => void;
  /** Asks a review of a team, or asks it no longer. */
  readonly pickTeam: (team: PullRequestReviewTeam, on: boolean) => void;
  /** Puts a label on, or takes it off. */
  readonly pickLabel: (label: PullRequestLabel, on: boolean) => void;
}

/**
 * The pull request's reviewers and labels with each choice the pickers made
 * drawn at once from what the repository's read holds, and sent through
 * `writes`; a choice GitHub did not make goes back at once, and the tab's
 * line says why.
 */
export function usePullRequestPicks(
  held: PickedHeld | undefined,
  writes: PullRequestWrites,
): PullRequestPicks {
  const people = usePicks(held?.requested ?? NO_PEOPLE, loginOf);
  const teams = usePicks(held?.requestedTeams ?? NO_TEAMS, slugOf);
  const labels = usePicks(held?.labels ?? NO_LABELS, nameOf);
  const send = (letGo: () => void, request: PullRequestActionRequest) =>
    void writes.write(request).then((outcome) => {
      if (!outcome.done) letGo();
    });
  const review = (
    on: boolean,
    reviewer: { kind: typeof REVIEWER_KIND.USER | typeof REVIEWER_KIND.TEAM; name: string },
  ) =>
    on
      ? { action: PULL_REQUEST_ACTION.REQUEST_REVIEW, reviewer }
      : { action: PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST, reviewer };
  return {
    requested: people.shown,
    requestedTeams: teams.shown,
    labels: labels.shown,
    pickPerson: (person, on) =>
      send(people.draw(person, on), review(on, { kind: REVIEWER_KIND.USER, name: person.login })),
    pickTeam: (team, on) =>
      send(teams.draw(team, on), review(on, { kind: REVIEWER_KIND.TEAM, name: team.slug })),
    pickLabel: (label, on) =>
      send(
        labels.draw(label, on),
        on
          ? { action: PULL_REQUEST_ACTION.ADD_LABEL, label: label.name }
          : { action: PULL_REQUEST_ACTION.REMOVE_LABEL, label: label.name },
      ),
  };
}

/** A label's colour as the dot its item leads with; a quiet dot for one GitHub spelled otherwise. */
function LabelDot({ color }: { color: string }): React.JSX.Element {
  const hex = /^[0-9a-f]{6}$/iu.test(color) ? `#${color}` : undefined;
  return (
    <span
      className="inline-block size-label-dot rounded-luke-full border border-border bg-label-dot"
      aria-hidden="true"
      style={hex === undefined ? undefined : cssCustomProperties({ "--label-dot": hex })}
    />
  );
}

/**
 * A picker's press, the same for both so they read as a pair: a plus and
 * the word for what it adds, quiet beside the faces and the labels, named
 * in full for a reader, opening its menu under it.
 */
function PickerButton({
  label,
  word,
  disabled,
  busy,
  busyLabel,
  trigger,
}: {
  label: string;
  /** What it adds, in a word: “Reviewer”, “Label”. */
  word: string;
  disabled: boolean;
  /** Whether a change its menu sent is out, and what it is named meanwhile. */
  busy: boolean;
  busyLabel: string;
  trigger: {
    readonly "aria-haspopup": "menu";
    readonly "aria-expanded": boolean;
    readonly onClick: (event: React.MouseEvent<HTMLElement>) => void;
  };
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <Button
        icon={<PlusIcon aria-hidden="true" />}
        // Note that the button is named by the word it draws, since "Edit reviewers" is the hint's and no reader hears a name the screen does not show.
        label={word}
        variant={BUTTON_VARIANT.SUBTLE}
        size={BUTTON_SIZE.COMPACT}
        disabled={disabled}
        busy={busy}
        busyLabel={busyLabel}
        {...trigger}
      >
        {word}
      </Button>
    </Tooltip>
  );
}

/**
 * One picker: its press, which reads what the repository offers as it first
 * opens, and the menu of `groups` under it, headed `heading`. It stands
 * disabled while a change is out or the pull request is read again.
 */
function OptionsPicker({
  label,
  word,
  heading,
  busyLabel,
  busyOn,
  groups,
  options,
  writes,
  refreshing,
}: {
  label: string;
  /** What it adds, in a word: “Reviewer”, “Label”. */
  word: string;
  heading: string;
  /** What the button is named while a change of its own is out. */
  busyLabel: string;
  /** The changes its menu sends, any of which out makes its button busy. */
  busyOn: readonly PullRequestAction[];
  groups: readonly (readonly MenuAction[])[];
  options: ReviewOptions;
  writes: PullRequestWrites;
  refreshing: boolean;
}): React.JSX.Element {
  const menu = useMenu(true);
  const busy = writes.pending !== undefined && busyOn.includes(writes.pending);
  return (
    <>
      <PickerButton
        label={label}
        word={word}
        // Note that a busy button takes no press of its own, so it is left to say so rather than drawn disabled.
        disabled={(writes.pending !== undefined && !busy) || refreshing}
        busy={busy}
        busyLabel={busyLabel}
        trigger={{
          ...menu.trigger(dropBelowStart),
          onClick: (event: React.MouseEvent<HTMLElement>) => {
            options.ask();
            menu.trigger(dropBelowStart).onClick(event);
          },
        }}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={heading}
          heading={heading}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The reviewer picker: a menu of the teams that reach the repository, then
 * its collaborators, the pull request's author left out, each checked while
 * a review is asked of them; choosing one asks a review of them, or asks it
 * no longer.
 */
export function ReviewerPicker({
  author,
  picks,
  options,
  writes,
  refreshing,
}: {
  /** Who opened the pull request, whom GitHub asks no review of. */
  author: string | undefined;
  /** Who is asked for a review, each choice drawn at once, and the doors that choose. */
  picks: PullRequestPicks;
  options: ReviewOptions;
  writes: PullRequestWrites;
  /** Whether the pull request is being read again, until which what it holds may be stale. */
  refreshing: boolean;
}): React.JSX.Element {
  const asked = new Set(picks.requested.map((person) => person.login));
  const askedTeams = new Set(picks.requestedTeams.map((team) => team.slug));
  const name = useNamer();
  return (
    <OptionsPicker
      label={PICKER_WORDS.REVIEWERS}
      word={PICKER_WORDS.REVIEWER}
      heading={PICKER_WORDS.REVIEWERS_MENU}
      busyLabel={PICKER_WORDS.REVIEWERS_BUSY}
      busyOn={REVIEWER_ACTIONS}
      groups={reviewerGroups(options, author, asked, askedTeams, picks, writes, name)}
      options={options}
      writes={writes}
      refreshing={refreshing}
    />
  );
}

/** The reviewer picker's groups: the teams, then the people by their GitHub face and card, each checked while asked; a stand-in while what they offer is read. */
function reviewerGroups(
  options: ReviewOptions,
  author: string | undefined,
  asked: ReadonlySet<string>,
  askedTeams: ReadonlySet<string>,
  picks: PullRequestPicks,
  writes: PullRequestWrites,
  name: (person: GitHubPerson) => Actor,
): readonly (readonly MenuAction[])[] {
  const { read } = options;
  if (read.kind !== OPTIONS.LANDED) return [[standInItem(options)]];
  const busy = writes.pending !== undefined;
  const teams = read.value.teams.map((team): MenuAction => {
    const on = askedTeams.has(team.slug);
    return {
      label: team.name,
      icon: <UsersRoundIcon aria-hidden="true" />,
      detail: PICKER_WORDS.TEAM,
      checked: on,
      disabled: busy,
      onSelect: () => picks.pickTeam(team, !on),
    };
  });
  const people = read.value.users
    .filter((user) => user.login !== author)
    .map((user): MenuAction => {
      const on = asked.has(user.login);
      const actor = name(user);
      return {
        label: user.login,
        icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />,
        card: actorCard(actor),
        checked: on,
        disabled: busy,
        onSelect: () => picks.pickPerson(user, !on),
      };
    });
  const groups = [teams, people].filter((group) => group.length > 0);
  return groups.length === 0
    ? [[{ label: PICKER_WORDS.NO_REVIEWERS, disabled: true, onSelect: () => undefined }]]
    : groups;
}

/**
 * The label picker: a menu of the repository's labels, each by its colour
 * and name, checked while it is on the pull request; choosing one puts it
 * on, or takes it off.
 */
export function LabelPicker({
  picks,
  options,
  writes,
  refreshing,
}: {
  /** The labels on, each choice drawn at once, and the door that chooses. */
  picks: PullRequestPicks;
  options: ReviewOptions;
  writes: PullRequestWrites;
  /** Whether the pull request is being read again, until which the labels it holds may be stale. */
  refreshing: boolean;
}): React.JSX.Element {
  const on = new Set(picks.labels.map((label) => label.name));
  return (
    <OptionsPicker
      label={PICKER_WORDS.LABELS}
      word={PICKER_WORDS.LABEL}
      heading={PICKER_WORDS.LABELS_MENU}
      busyLabel={PICKER_WORDS.LABELS_BUSY}
      busyOn={LABEL_ACTIONS}
      groups={[labelItems(options, on, picks, writes)]}
      options={options}
      writes={writes}
      refreshing={refreshing}
    />
  );
}

/** The label picker's items, each checked while on; a stand-in while what it offers is read. */
function labelItems(
  options: ReviewOptions,
  on: ReadonlySet<string>,
  picks: PullRequestPicks,
  writes: PullRequestWrites,
): readonly MenuAction[] {
  const { read } = options;
  if (read.kind !== OPTIONS.LANDED) return [standInItem(options)];
  if (read.value.labels.length === 0) {
    return [{ label: PICKER_WORDS.NO_LABELS, disabled: true, onSelect: () => undefined }];
  }
  return read.value.labels.map((label): MenuAction => {
    const labelled = on.has(label.name);
    return {
      label: label.name,
      icon: <LabelDot color={label.color} />,
      checked: labelled,
      disabled: writes.pending !== undefined,
      onSelect: () => picks.pickLabel(label, !labelled),
    };
  });
}
