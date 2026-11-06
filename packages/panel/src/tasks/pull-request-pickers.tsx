import { PULL_REQUEST_PART } from "@repo/features/agent-view";
import type {
  AgentReviewOptions,
  GitHubPerson,
  PullRequestLabel,
  PullRequestReviewTeam,
} from "@repo/features/agent-wire";
import {
  PULL_REQUEST_ACTION,
  type PullRequestAction,
  type PullRequestActionRequest,
  REVIEWER_KIND,
} from "@repo/features/pull-request-write-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  cssCustomProperties,
  MenuNoteRow,
  POPOVER_ALIGN,
  Spinner,
  Tooltip,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import {
  type PendingValues,
  pendingSettled,
  pendingValue,
  pendingWithout,
  type SameValue,
} from "@repo/ui/pending-values";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon, UsersRoundIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, actorCard } from "../actor-ref.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { type ActionSearch, ActionSearchMenu } from "../desktop/action-search-menu.js";
import { pullRequestPartRetryMutation, reviewOptionsQuery } from "../live-reads.js";
import { usePendingNow } from "../pending-clock.js";
import { useNamer } from "./pull-request-people.js";
import type { PullRequestWrites } from "./pull-request-writes.js";

const PICKER_WORDS = {
  REVIEWERS: "Edit reviewers",
  LABELS: "Edit labels",
  REVIEWER: "Reviewer",
  LABEL: "Label",
  REVIEWERS_BUSY: "Updating reviewers",
  LABELS_BUSY: "Updating labels",
  REVIEWERS_MENU: "Request a review",
  LABELS_MENU: "Labels",
  LABELS_SEARCH: "Search labels",
  NO_REVIEWER_MATCH: "No one matches",
  NO_LABEL_MATCH: "No labels match",
  READING: "Reading the repository…",
  FAILED: "The repository could not be read.",
  RETRY: "Retry",
  NO_REVIEWERS: "Nobody else may be asked.",
  NO_LABELS: "This repository has no labels.",
  TEAM: "Team",
} as const;

const REVIEWER_ACTIONS: readonly PullRequestAction[] = [
  PULL_REQUEST_ACTION.REQUEST_REVIEW,
  PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST,
];
const LABEL_ACTIONS: readonly PullRequestAction[] = [
  PULL_REQUEST_ACTION.ADD_LABEL,
  PULL_REQUEST_ACTION.REMOVE_LABEL,
];

const OPTIONS = {
  UNASKED: "unasked",
  READING: "reading",
  FAILED: "failed",
  LANDED: "landed",
} as const;

type OptionsRead =
  | { readonly kind: typeof OPTIONS.UNASKED | typeof OPTIONS.READING | typeof OPTIONS.FAILED }
  | { readonly kind: typeof OPTIONS.LANDED; readonly value: AgentReviewOptions };

export interface ReviewOptions {
  readonly read: OptionsRead;
  readonly ask: () => void;
}

export function useReviewOptions(agentId: string): ReviewOptions {
  const [asked, setAsked] = useState<string | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const held = useQuery(reviewOptionsQuery(asked === agentId ? { agentId } : undefined));
  const { mutateAsync: retry } = useMutation(pullRequestPartRetryMutation());
  const answer = held.data;
  const read: OptionsRead =
    asked !== agentId
      ? { kind: OPTIONS.UNASKED }
      : retrying || (answer === undefined && held.isPending)
        ? { kind: OPTIONS.READING }
        : answer === undefined || "failure" in answer
          ? { kind: OPTIONS.FAILED }
          : { kind: OPTIONS.LANDED, value: answer };
  const ask = useCallback(() => {
    if (asked !== agentId) return setAsked(agentId);
    if (read.kind !== OPTIONS.FAILED) return;
    setRetrying(true);
    void retry({ part: PULL_REQUEST_PART.REVIEW_OPTIONS, agentId })
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  }, [agentId, asked, read.kind, retry]);
  return { read, ask };
}

function optionsNote(options: ReviewOptions, offered: number, none: string): React.ReactNode {
  if (options.read.kind === OPTIONS.FAILED) {
    return (
      <MenuNoteRow
        glyph={<GLYPH.RETRY aria-hidden="true" />}
        label={PICKER_WORDS.FAILED}
        end={{ action: PICKER_WORDS.RETRY, onClick: options.ask }}
      />
    );
  }
  if (options.read.kind !== OPTIONS.LANDED) return <Spinner delay label={PICKER_WORDS.READING} />;
  return offered === 0 ? none : undefined;
}

interface PickedHeld {
  readonly requested: readonly GitHubPerson[];
  readonly requestedTeams?: readonly PullRequestReviewTeam[] | undefined;
  readonly labels?: readonly PullRequestLabel[] | undefined;
}

type Picks<T> = PendingValues<string, T | null>;

const samePick: SameValue<unknown> = (a, b) => (a === null) === (b === null);

const NO_PEOPLE: readonly GitHubPerson[] = [];
const NO_TEAMS: readonly PullRequestReviewTeam[] = [];
const NO_LABELS: readonly PullRequestLabel[] = [];
const loginOf = (person: GitHubPerson) => person.login;
const slugOf = (team: PullRequestReviewTeam) => team.slug;
const nameOf = (label: PullRequestLabel) => label.name;

function heldOf<T>(held: readonly T[], keyOf: (each: T) => string, key: string): T | null {
  return held.find((each) => keyOf(each) === key) ?? null;
}

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

export interface PullRequestPicks {
  readonly requested: readonly GitHubPerson[];
  readonly requestedTeams: readonly PullRequestReviewTeam[];
  readonly labels: readonly PullRequestLabel[];
  readonly pickPerson: (person: GitHubPerson, on: boolean) => void;
  readonly pickTeam: (team: PullRequestReviewTeam, on: boolean) => void;
  readonly pickLabel: (label: PullRequestLabel, on: boolean) => void;
}

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

function LabelDot({ color }: { color: string }): React.JSX.Element {
  const hex = /^[0-9a-f]{6}$/iu.test(color) ? `#${color}` : undefined;
  return (
    <span
      className="inline-block size-label-dot rounded-ui-full border border-border bg-label-dot"
      aria-hidden="true"
      style={hex === undefined ? undefined : cssCustomProperties({ "--label-dot": hex })}
    />
  );
}

function PickerButton({
  ref,
  label,
  word,
  disabled,
  busy,
  busyLabel,
  open,
  menuId,
  onPress,
}: {
  ref: React.Ref<HTMLButtonElement>;
  label: string;
  word: string;
  disabled: boolean;
  busy: boolean;
  busyLabel: string;
  open: boolean;
  menuId: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={open ? undefined : label}>
      <Button
        ref={ref}
        icon={<PlusIcon aria-hidden="true" />}
        label={word}
        variant={BUTTON_VARIANT.SUBTLE}
        size={BUTTON_SIZE.COMPACT}
        disabled={disabled}
        busy={busy}
        busyLabel={busyLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onPress}
      >
        {word}
      </Button>
    </Tooltip>
  );
}

function OptionsPicker({
  label,
  word,
  busyLabel,
  busyOn,
  search,
  options,
  writes,
  refreshing,
}: {
  label: string;
  word: string;
  busyLabel: string;
  busyOn: readonly PullRequestAction[];
  search: ActionSearch;
  options: ReviewOptions;
  writes: PullRequestWrites;
  refreshing: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const busy = writes.pending !== undefined && busyOn.includes(writes.pending);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span className="pull-request-picker relative inline-flex" ref={box}>
      <PickerButton
        ref={button}
        label={label}
        word={word}
        disabled={(writes.pending !== undefined && !busy) || refreshing}
        busy={busy}
        busyLabel={busyLabel}
        open={open}
        menuId={menuId}
        onPress={() => {
          if (!open) options.ask();
          setOpen(!open);
        }}
      />
      {drawn.mounted ? (
        <ActionSearchMenu
          id={menuId}
          search={search}
          place={{ align: POPOVER_ALIGN.START }}
          leaving={drawn.leaving}
          menuRef={drawn.ref}
          onDone={close}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && box.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}

export function ReviewerPicker({
  author,
  picks,
  options,
  writes,
  refreshing,
}: {
  author: string | undefined;
  picks: PullRequestPicks;
  options: ReviewOptions;
  writes: PullRequestWrites;
  refreshing: boolean;
}): React.JSX.Element {
  const asked = new Set(picks.requested.map((person) => person.login));
  const askedTeams = new Set(picks.requestedTeams.map((team) => team.slug));
  const name = useNamer();
  const actions = reviewerActions(options, author, asked, askedTeams, picks, name);
  return (
    <OptionsPicker
      label={PICKER_WORDS.REVIEWERS}
      word={PICKER_WORDS.REVIEWER}
      busyLabel={PICKER_WORDS.REVIEWERS_BUSY}
      busyOn={REVIEWER_ACTIONS}
      search={{
        label: PICKER_WORDS.REVIEWERS_MENU,
        placeholder: PICKER_WORDS.REVIEWERS_MENU,
        noMatch: PICKER_WORDS.NO_REVIEWER_MATCH,
        actions,
        note: optionsNote(options, actions.length, PICKER_WORDS.NO_REVIEWERS),
        replayUnmasked: true,
      }}
      options={options}
      writes={writes}
      refreshing={refreshing}
    />
  );
}

function reviewerActions(
  options: ReviewOptions,
  author: string | undefined,
  asked: ReadonlySet<string>,
  askedTeams: ReadonlySet<string>,
  picks: PullRequestPicks,
  name: (person: GitHubPerson) => Actor,
): readonly MenuAction[] {
  const { read } = options;
  if (read.kind !== OPTIONS.LANDED) return [];
  const teams = read.value.teams.map((team): MenuAction => {
    const on = askedTeams.has(team.slug);
    return {
      label: team.name,
      replayMasked: true,
      icon: <UsersRoundIcon aria-hidden="true" />,
      detail: PICKER_WORDS.TEAM,
      checked: on,
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
        replayMasked: true,
        icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />,
        card: actorCard(actor),
        checked: on,
        onSelect: () => picks.pickPerson(user, !on),
      };
    });
  return [...teams, ...people];
}

export function LabelPicker({
  picks,
  options,
  writes,
  refreshing,
}: {
  picks: PullRequestPicks;
  options: ReviewOptions;
  writes: PullRequestWrites;
  refreshing: boolean;
}): React.JSX.Element {
  const on = new Set(picks.labels.map((label) => label.name));
  const actions = labelActions(options, on, picks);
  return (
    <OptionsPicker
      label={PICKER_WORDS.LABELS}
      word={PICKER_WORDS.LABEL}
      busyLabel={PICKER_WORDS.LABELS_BUSY}
      busyOn={LABEL_ACTIONS}
      search={{
        label: PICKER_WORDS.LABELS_MENU,
        placeholder: PICKER_WORDS.LABELS_SEARCH,
        noMatch: PICKER_WORDS.NO_LABEL_MATCH,
        actions,
        note: optionsNote(options, actions.length, PICKER_WORDS.NO_LABELS),
        replayUnmasked: true,
      }}
      options={options}
      writes={writes}
      refreshing={refreshing}
    />
  );
}

function labelActions(
  options: ReviewOptions,
  on: ReadonlySet<string>,
  picks: PullRequestPicks,
): readonly MenuAction[] {
  const { read } = options;
  if (read.kind !== OPTIONS.LANDED) return [];
  return read.value.labels.map((label): MenuAction => {
    const labeled = on.has(label.name);
    return {
      label: label.name,
      replayMasked: true,
      icon: <LabelDot color={label.color} />,
      checked: labeled,
      onSelect: () => picks.pickLabel(label, !labeled),
    };
  });
}
