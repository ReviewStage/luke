import type { GitHubRepository } from "@sidecar/hosted/github-wire";
import type { GitHubCallFailure } from "@sidecar/hosted/planning-view";
import { useCallback, useEffect, useId, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { githubFailureNote, offersGitHubConnect, repositoriesMatching } from "./planning-model";

/**
 * setup-sheet.tsx -- the new-plan sheet: Connect GitHub while the account has no connection, the plan's name, and the repository it plans against.
 *
 * Ordinary setup fields and nothing spoken: nothing typed here reaches the
 * model as conversation. Start plan asks the host to start the plan, and the
 * service resolves the repository's default branch to the one commit the
 * plan reads for its whole life; a refusal keeps the sheet open with the
 * reason, and the button can be pressed again.
 */

/** Where the repository list stands. */
export const REPOSITORY_LIST = {
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
} as const;

type RepositoryList =
  | { readonly status: typeof REPOSITORY_LIST.READING }
  | {
      readonly status: typeof REPOSITORY_LIST.READY;
      readonly repositories: readonly GitHubRepository[];
      readonly truncated: boolean;
    }
  | { readonly status: typeof REPOSITORY_LIST.FAILED; readonly failure: GitHubCallFailure };

interface RepositoryChoice {
  readonly owner: string;
  readonly name: string;
}

/** Everything the sheet draws, handed in whole so the layout decides nothing. */
export interface SetupSheetViewProps {
  name: string;
  filter: string;
  chosen: RepositoryChoice | undefined;
  list: RepositoryList;
  starting: boolean;
  /** Why the last Start plan or Connect GitHub press did not land, in the sheet's words. */
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

/** The repository half of the sheet: Connect GitHub, the reason a read failed, or the filterable list. */
function RepositoryField(props: SetupSheetViewProps): React.JSX.Element {
  const { list } = props;
  if (list.status === REPOSITORY_LIST.READING) {
    return <p className="plan-sheet-note">Reading your repositories…</p>;
  }
  if (list.status === REPOSITORY_LIST.FAILED) {
    return (
      <div className="plan-sheet-github">
        <p className="plan-sheet-note">{githubFailureNote(list.failure)}</p>
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
    <fieldset className="plan-sheet-repositories">
      <legend>Repository</legend>
      <input
        type="search"
        className="plan-sheet-filter"
        placeholder="Filter repositories"
        aria-label="Filter repositories"
        value={props.filter}
        onChange={(event) => props.onFilter(event.currentTarget.value)}
      />
      <ul className="plan-sheet-repository-list">
        {shown.map((repository, index) => (
          // A repository is its owner and name together; the radio's own checked state carries the choice, so a position is key enough.
          // oxlint-disable-next-line react/no-array-index-key -- the list is redrawn whole from the filter.
          <li key={index}>
            <label className="plan-sheet-repository">
              <input
                type="radio"
                name="repository"
                checked={sameRepository(props.chosen, repository)}
                onChange={() => props.onChoose({ owner: repository.owner, name: repository.name })}
              />
              <span>
                {repository.owner}/{repository.name}
              </span>
              {repository.private ? <small className="plan-sheet-private">Private</small> : null}
            </label>
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <p className="plan-sheet-note">No repository matches.</p> : null}
      {list.truncated ? (
        <p className="plan-sheet-note">Only your most recently pushed repositories are listed.</p>
      ) : null}
    </fieldset>
  );
}

export function SetupSheetView(props: SetupSheetViewProps): React.JSX.Element {
  const titleId = useId();
  const canStart = props.name.trim().length > 0 && props.chosen !== undefined && !props.starting;
  return (
    <div className="plan-sheet-backdrop">
      <form
        className="plan-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart) props.onStart();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onCancel();
        }}
      >
        <h2 id={titleId}>New plan</h2>
        <label className="plan-sheet-name">
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
          <p className="plan-sheet-note" role="alert">
            {props.note}
          </p>
        ) : null}
        <div className="plan-sheet-actions">
          <button type="button" className="plan-button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="plan-button plan-button-primary" disabled={!canStart}>
            {props.starting ? "Starting…" : "Start plan"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The sheet with its own state: the fields, the repository list read when it
 * opens and again on Try again, and the Start plan and Connect GitHub presses.
 * `onStarted` closes it once the host says the plan started, which is also
 * when the new plan becomes the active one.
 */
export function SetupSheet({
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

  const readList = useCallback(() => {
    setList({ status: REPOSITORY_LIST.READING });
    act(ACT_KIND.PLANNING_REPOSITORIES).then(
      (answer) =>
        setList(
          "failure" in answer
            ? { status: REPOSITORY_LIST.FAILED, failure: answer.failure }
            : { status: REPOSITORY_LIST.READY, ...answer },
        ),
      (refused: Error) => setNote(refused.message),
    );
  }, [act]);
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

  // The connection's own flow is not built yet; its door answers with the
  // sentence the sheet draws, and a connection that lands reads the list again.
  const connect = () => {
    setNote(undefined);
    act(ACT_KIND.PLANNING_CONNECT_GITHUB).then(readList, (refused: Error) =>
      setNote(refused.message),
    );
  };

  return (
    <SetupSheetView
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
