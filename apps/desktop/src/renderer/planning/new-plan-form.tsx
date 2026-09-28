import type { GitHubRepository } from "@sidecar/hosted/github-wire";
import {
  type GitHubCallFailure,
  PLAN_CALL_FAILURE,
  type PlanningRepositoriesAnswer,
} from "@sidecar/hosted/planning-view";
import { BackIcon } from "@sidecar/panel";
import { useCallback, useEffect, useId, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  githubFailureNote,
  newestReadOnly,
  offersGitHubConnect,
  onEachReturn,
  repositoriesMatching,
} from "./planning-model";

/**
 * new-plan-form.tsx -- the Plans tab's new-plan page: Connect GitHub while the account has no connection, the plan's name, and the repository it plans against.
 *
 * Ordinary setup fields and nothing spoken: nothing typed here reaches the
 * model as conversation. Start plan asks the host to start the plan, and the
 * service resolves the repository's default branch to the one commit the
 * plan reads for its whole life; a refusal keeps the page open with the
 * reason, and the button can be pressed again. Escape and Back return to the
 * list, the first through the panel's own Escape ladder.
 */

/** Where the repository list stands. */
export const REPOSITORY_LIST = {
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
} as const;

export type RepositoryList =
  | { readonly status: typeof REPOSITORY_LIST.READING }
  | {
      readonly status: typeof REPOSITORY_LIST.READY;
      readonly repositories: readonly GitHubRepository[];
      readonly truncated: boolean;
    }
  | { readonly status: typeof REPOSITORY_LIST.FAILED; readonly failure: GitHubCallFailure };

/**
 * Reads the repository list through the ask the caller hands in and answers
 * where the list stands. A refused ask is the failed list with Try again,
 * never a rejection, so the page never stays on its reading line.
 */
export async function readRepositoryList(
  ask: () => Promise<PlanningRepositoriesAnswer>,
): Promise<RepositoryList> {
  try {
    const answer = await ask();
    return "failure" in answer
      ? { status: REPOSITORY_LIST.FAILED, failure: answer.failure }
      : { status: REPOSITORY_LIST.READY, ...answer };
  } catch {
    return { status: REPOSITORY_LIST.FAILED, failure: PLAN_CALL_FAILURE.UNANSWERED };
  }
}

interface RepositoryChoice {
  readonly owner: string;
  readonly name: string;
}

/** Everything the page draws, handed in whole so the layout decides nothing. */
export interface NewPlanFormViewProps {
  name: string;
  filter: string;
  chosen: RepositoryChoice | undefined;
  list: RepositoryList;
  starting: boolean;
  /** Why the last Start plan or Connect GitHub press did not land, in the page's words. */
  note: string | undefined;
  onName: (name: string) => void;
  onFilter: (filter: string) => void;
  onChoose: (choice: RepositoryChoice) => void;
  onConnect: () => void;
  onRetryList: () => void;
  onStart: () => void;
  onCancel: () => void;
}

function sameRepository(a: RepositoryChoice | undefined, b: RepositoryChoice): boolean {
  return a !== undefined && a.owner === b.owner && a.name === b.name;
}

/** The repository half of the page: Connect GitHub, the reason a read failed, or the filterable list. */
function RepositoryField(props: NewPlanFormViewProps): React.JSX.Element {
  const { list } = props;
  if (list.status === REPOSITORY_LIST.READING) {
    return <p className="plan-form-note">Reading your repositories…</p>;
  }
  if (list.status === REPOSITORY_LIST.FAILED) {
    return (
      <div className="plan-form-github">
        <p className="plan-form-note">{githubFailureNote(list.failure)}</p>
        {offersGitHubConnect(list.failure) ? (
          <button type="button" className="plan-button" onClick={props.onConnect}>
            Connect GitHub
          </button>
        ) : (
          <button type="button" className="plan-button" onClick={props.onRetryList}>
            Try again
          </button>
        )}
      </div>
    );
  }
  const shown = repositoriesMatching(list.repositories, props.filter);
  return (
    <fieldset className="plan-form-repositories">
      <legend>Repository</legend>
      <input
        type="search"
        className="plan-form-filter"
        placeholder="Filter repositories"
        aria-label="Filter repositories"
        value={props.filter}
        onChange={(event) => props.onFilter(event.currentTarget.value)}
      />
      <ul className="plan-form-repository-list">
        {shown.map((repository, index) => (
          // A repository is its owner and name together; the radio's own checked state carries the choice, so a position is key enough.
          // oxlint-disable-next-line react/no-array-index-key -- the list is redrawn whole from the filter.
          <li key={index}>
            <label className="plan-form-repository">
              <input
                type="radio"
                name="repository"
                checked={sameRepository(props.chosen, repository)}
                onChange={() => props.onChoose({ owner: repository.owner, name: repository.name })}
              />
              <span>
                {repository.owner}/{repository.name}
              </span>
              {repository.private ? <small className="plan-form-private">Private</small> : null}
            </label>
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <p className="plan-form-note">No repository matches.</p> : null}
      {list.truncated ? (
        <p className="plan-form-note">Only your most recently pushed repositories are listed.</p>
      ) : null}
    </fieldset>
  );
}

export function NewPlanFormView(props: NewPlanFormViewProps): React.JSX.Element {
  const titleId = useId();
  const canStart = props.name.trim().length > 0 && props.chosen !== undefined && !props.starting;
  return (
    <section className="plan-new" aria-labelledby={titleId}>
      <header className="plan-header">
        <button
          type="button"
          className="icon-button plan-back"
          aria-label="Back to plans"
          title="Back"
          onClick={props.onCancel}
        >
          <BackIcon />
        </button>
        <h1 id={titleId} className="plan-title">
          New plan
        </h1>
      </header>
      <form
        className="plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart) props.onStart();
        }}
      >
        <label className="plan-form-name">
          <span>Name</span>
          <input
            type="text"
            value={props.name}
            placeholder="Teammate invitations"
            maxLength={200}
            onChange={(event) => props.onName(event.currentTarget.value)}
          />
        </label>
        <RepositoryField {...props} />
        {props.note !== undefined ? (
          <p className="plan-form-note" role="alert">
            {props.note}
          </p>
        ) : null}
        <div className="plan-form-actions">
          <button type="button" className="plan-button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="plan-button plan-button-primary" disabled={!canStart}>
            {props.starting ? "Starting…" : "Start plan"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** What the page says once the Connect GitHub page is open in the browser. */
const GITHUB_CONNECT_IN_BROWSER = "Finish connecting GitHub in your browser, then come back here.";

/**
 * The page with its own state: the fields, the repository list read when it
 * opens and again on Try again, and the Start plan and Connect GitHub presses.
 * `onStarted` closes it once the host says the plan started, which is also
 * when the new plan becomes the active one.
 */
export function NewPlanForm({
  onStarted,
  onCancel,
}: {
  onStarted: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<RepositoryChoice | undefined>(undefined);
  const [list, setList] = useState<RepositoryList>({ status: REPOSITORY_LIST.READING });
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  // Reads overlap (a return from the browser, Try again), so only the newest
  // one's answer is drawn: an older read landing late never undoes it.
  const [applyNewest] = useState(() => newestReadOnly<RepositoryList>());
  const readList = useCallback(() => {
    setList({ status: REPOSITORY_LIST.READING });
    applyNewest(
      readRepositoryList(() => act(ACT_KIND.PLANNING_REPOSITORIES)),
      setList,
    );
  }, [act, applyNewest]);
  useEffect(readList, [readList]);

  const start = () => {
    if (chosen === undefined) return;
    setStarting(true);
    setNote(undefined);
    act(ACT_KIND.PLANNING_START, { name, repository: chosen })
      .then(
        (answer) => {
          if ("failure" in answer) setNote(githubFailureNote(answer.failure));
          else onStarted();
        },
        (refused: Error) => setNote(refused.message),
      )
      .finally(() => setStarting(false));
  };

  // The link happens in the browser, so the press only opens it: the page
  // says where to finish, and reads the list again when the panel is back.
  const [connecting, setConnecting] = useState(false);
  const connect = () => {
    setNote(undefined);
    act(ACT_KIND.PLANNING_CONNECT_GITHUB).then(
      () => {
        setConnecting(true);
        setNote(GITHUB_CONNECT_IN_BROWSER);
      },
      (refused: Error) => setNote(refused.message),
    );
  };
  // Every return reads again, since a return mid-way through GitHub's page
  // finds no connection yet; the list reading at last is what ends the wait.
  useEffect(() => {
    if (!connecting) return;
    return onEachReturn(window, readList);
  }, [connecting, readList]);
  useEffect(() => {
    if (!connecting || list.status !== REPOSITORY_LIST.READY) return;
    setConnecting(false);
    setNote(undefined);
  }, [connecting, list]);

  return (
    <NewPlanFormView
      name={name}
      filter={filter}
      chosen={chosen}
      list={list}
      starting={starting}
      note={note}
      onName={setName}
      onFilter={setFilter}
      onChoose={setChosen}
      onConnect={connect}
      onRetryList={readList}
      onStart={start}
      onCancel={onCancel}
    />
  );
}
