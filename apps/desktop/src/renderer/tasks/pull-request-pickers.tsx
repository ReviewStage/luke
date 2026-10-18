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
import { PULL_REQUEST_ACTION, REVIEWER_KIND } from "@luke/features/pull-request-write-wire";
import { BUTTON_SIZE, cssCustomProperties, dropBelowStart, IconButton, useMenu } from "@luke/ui";
import { TagIcon, UserPlusIcon, UserRoundIcon, UsersRoundIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { Tooltip } from "../tooltip";
import type { PullRequestWrites } from "./pull-request-writes";

/**
 * pull-request-pickers.tsx -- the header's reviewer and label pickers, as stage-cli's are: a press beside the reviewers and one beside the labels, each a menu of what may be asked for or put on, what stands now checked.
 *
 * What the pickers offer is the agent's repository's (`review-options`):
 * its collaborators and the teams that reach it, who may be asked for a
 * review, and its labels. It is read once, as a picker first opens, on the
 * Luke GitHub App's token as every read is, and read again only where that
 * read failed. Choosing an item is one change, sent through the tab's own
 * writes (`pull-request-writes.tsx`): asking or no longer asking a review
 * of a user or a team, putting a label on or taking it off. That change is
 * made on GitHub as the member pressing it, on their own sign-in, and the
 * tab's reads are asked again once GitHub answers, so the header says what
 * GitHub holds rather than what the press assumed; GitHub's refusal stands
 * on the tab's line under the bar. While a change is out, and until the
 * read after it lands, the pickers stand disabled, so none is chosen from
 * what the pull request held before. A pull request merged or closed asks no review, so only its
 * labels are offered.
 */

/** The pickers' own words. */
const PICKER_WORDS = {
  REVIEWERS: "Edit reviewers",
  LABELS: "Edit labels",
  REVIEWERS_MENU: "Request a review",
  LABELS_MENU: "Labels",
  READING: "Reading the repository…",
  FAILED: "The repository could not be read.",
  NO_REVIEWERS: "Nobody else may be asked.",
  NO_LABELS: "This repository has no labels.",
  TEAM: "Team",
} as const;

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

/** The one item a menu holds while what it would offer is read, or could not be. */
function standInItem(read: OptionsRead): MenuAction {
  const label = read.kind === OPTIONS.FAILED ? PICKER_WORDS.FAILED : PICKER_WORDS.READING;
  return { label, disabled: true, onSelect: () => undefined };
}

/** A label's colour as the dot its item leads with; a quiet dot for one GitHub spelled otherwise. */
function LabelDot({ color }: { color: string }): React.JSX.Element {
  const hex = /^[0-9a-f]{6}$/iu.test(color) ? `#${color}` : undefined;
  return (
    <span
      className="pull-request-label-dot"
      aria-hidden="true"
      style={hex === undefined ? undefined : cssCustomProperties({ "--label-dot": hex })}
    />
  );
}

/** A picker's press: its glyph, named for a reader who cannot see it, opening its menu under it. */
function PickerButton({
  label,
  icon,
  disabled,
  trigger,
}: {
  label: string;
  icon: React.JSX.Element;
  disabled: boolean;
  trigger: {
    readonly "aria-haspopup": "menu";
    readonly "aria-expanded": boolean;
    readonly onClick: (event: React.MouseEvent<HTMLElement>) => void;
  };
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <IconButton
        icon={icon}
        label={label}
        size={BUTTON_SIZE.COMPACT}
        disabled={disabled}
        {...trigger}
      />
    </Tooltip>
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
  requested,
  requestedTeams,
  options,
  writes,
  refreshing,
}: {
  /** Who opened the pull request, whom GitHub asks no review of. */
  author: string | undefined;
  requested: readonly GitHubPerson[];
  requestedTeams: readonly PullRequestReviewTeam[];
  options: ReviewOptions;
  writes: PullRequestWrites;
  /** Whether the pull request is being read again, until which what it holds may be stale. */
  refreshing: boolean;
}): React.JSX.Element {
  const menu = useMenu(true);
  const asked = new Set(requested.map((person) => person.login));
  const askedTeams = new Set(requestedTeams.map((team) => team.slug));
  const groups = reviewerGroups(options.read, author, asked, askedTeams, writes);
  return (
    <>
      <PickerButton
        label={PICKER_WORDS.REVIEWERS}
        icon={<UserPlusIcon />}
        disabled={writes.pending !== undefined || refreshing}
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
          label={PICKER_WORDS.REVIEWERS_MENU}
          heading={PICKER_WORDS.REVIEWERS_MENU}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The reviewer picker's groups: the teams, then the people, each checked while asked; a stand-in while what they offer is read. */
function reviewerGroups(
  read: OptionsRead,
  author: string | undefined,
  asked: ReadonlySet<string>,
  askedTeams: ReadonlySet<string>,
  writes: PullRequestWrites,
): readonly (readonly MenuAction[])[] {
  if (read.kind !== OPTIONS.LANDED) return [[standInItem(read)]];
  const busy = writes.pending !== undefined;
  const teams = read.value.teams.map((team): MenuAction => {
    const on = askedTeams.has(team.slug);
    const reviewer = { kind: REVIEWER_KIND.TEAM, name: team.slug };
    return {
      label: team.name,
      icon: <UsersRoundIcon aria-hidden="true" />,
      detail: PICKER_WORDS.TEAM,
      checked: on,
      disabled: busy,
      onSelect: () =>
        writes.write(
          on
            ? { action: PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST, reviewer }
            : { action: PULL_REQUEST_ACTION.REQUEST_REVIEW, reviewer },
        ),
    };
  });
  const people = read.value.users
    .filter((user) => user.login !== author)
    .map((user): MenuAction => {
      const on = asked.has(user.login);
      const reviewer = { kind: REVIEWER_KIND.USER, name: user.login };
      return {
        label: user.login,
        icon: <UserRoundIcon aria-hidden="true" />,
        checked: on,
        disabled: busy,
        onSelect: () =>
          writes.write(
            on
              ? { action: PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST, reviewer }
              : { action: PULL_REQUEST_ACTION.REQUEST_REVIEW, reviewer },
          ),
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
  labels,
  options,
  writes,
  refreshing,
}: {
  labels: readonly PullRequestLabel[];
  options: ReviewOptions;
  writes: PullRequestWrites;
  /** Whether the pull request is being read again, until which the labels it holds may be stale. */
  refreshing: boolean;
}): React.JSX.Element {
  const menu = useMenu(true);
  const on = new Set(labels.map((label) => label.name));
  const items = labelItems(options.read, on, writes);
  return (
    <>
      <PickerButton
        label={PICKER_WORDS.LABELS}
        icon={<TagIcon />}
        disabled={writes.pending !== undefined || refreshing}
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
          label={PICKER_WORDS.LABELS_MENU}
          heading={PICKER_WORDS.LABELS_MENU}
          menu={menu.drawn}
          groups={[items]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The label picker's items, each checked while on; a stand-in while what it offers is read. */
function labelItems(
  read: OptionsRead,
  on: ReadonlySet<string>,
  writes: PullRequestWrites,
): readonly MenuAction[] {
  if (read.kind !== OPTIONS.LANDED) return [standInItem(read)];
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
      onSelect: () =>
        writes.write(
          labelled
            ? { action: PULL_REQUEST_ACTION.REMOVE_LABEL, label: label.name }
            : { action: PULL_REQUEST_ACTION.ADD_LABEL, label: label.name },
        ),
    };
  });
}
