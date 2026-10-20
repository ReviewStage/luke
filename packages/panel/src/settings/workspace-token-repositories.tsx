import {
  GITHUB_ACCESS,
  type WorkspaceTokenRepository,
} from "@luke/features/github-repositories-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Badge, BUTTON_VARIANT, Button, SETTINGS_ROW_INDENT, SettingsRow } from "@luke/ui";
import { githubAccountPictureUrl } from "@luke/ui/tasks-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAct } from "../act.js";
import { WorkspaceTile } from "../desktop/workspace-tile.js";
import { type MenuRow, SearchableMenu } from "../searchable-menu.js";
import { PICKER_ALIGN, usePickerPlacement } from "./picker-row.js";

/**
 * workspace-token-repositories.tsx -- the repositories members added to a workspace on their own GitHub tokens, under GitHub's row on Settings › Workspace.
 *
 * Each stands inset under GitHub's row, as a connected account does, led by
 * its owner's picture on GitHub and marked Token, with Remove for its adder
 * and for a workspace's owner or admin. One the workspace's App reaches is
 * left out by the service, since the App wins. Add repository drops the
 * app's searched menu over the repositories the reader's own token may
 * push to that neither the App nor the workspace's list already holds, read
 * from the repository picker's own listing as the menu opens; a pick adds
 * it, and the service answers the list as it then stands.
 */

/** The words the rows and the menu say: labels and facts alone. */
const WORDS = {
  ADD: "Add repository",
  TOKEN: "Token",
  REMOVE: "Remove",
  REMOVING: "Removing",
  SEARCH: "Search repositories",
  NO_MATCH: "No matching repositories",
  NONE: "No repositories",
  READING: "Loading repositories",
  NOT_READ: "The repositories could not be read.",
} as const;

/** The workspace's token repositories as last read, and the change that moves them. */
export interface TokenRepositories {
  readonly listed: readonly WorkspaceTokenRepository[];
  /** Adds or removes one, answering what the service refused with, or nothing where it took it. */
  readonly change: (repository: string, added: boolean) => Promise<string | undefined>;
}

/** Reads the workspace's token repositories once, and holds what each change answers. */
export function useTokenRepositories(workspaceId: string): TokenRepositories {
  const { act } = useAct();
  const [listed, setListed] = useState<readonly WorkspaceTokenRepository[]>([]);
  useEffect(() => {
    let live = true;
    // A read that fails lists none, as a workspace with none does: the list holds no state of its own to lose.
    act(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_READ, { workspaceId }).then(
      (read) => {
        if (live) setListed(read);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId]);
  const change = useCallback(
    (repository: string, added: boolean) =>
      act(ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET, { workspaceId, repository, added }).then(
        (now) => {
          setListed(now);
          return undefined;
        },
        (refused: Error) => refused.message,
      ),
    [act, workspaceId],
  );
  return { listed, change };
}

/** The repositories the reader's own token may push to that the workspace lists nowhere yet; nothing while unread, and why where the read failed. */
type Candidates =
  | { readonly kind: "reading" }
  | { readonly kind: "failed" }
  | { readonly kind: "read"; readonly rows: readonly MenuRow[] };

/**
 * Add repository and its menu: the outline `Button`, and under it the
 * app's searched menu placed as a Settings picker's is.
 */
export function AddTokenRepository({
  workspaceId,
  repositories,
  onRefused,
}: {
  workspaceId: string;
  repositories: TokenRepositories;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidates>({ kind: "reading" });
  const drawn = useDisclosure(open);
  const menuId = useId();
  const holder = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const placement = usePickerPlacement(open, button, PICKER_ALIGN.END);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const read = () => {
    setCandidates({ kind: "reading" });
    const added = new Set(repositories.listed.map((one) => one.fullName.toLowerCase()));
    act(ACT_KIND.TASKS_REPOSITORIES, { workspaceId }).then(
      (answer) => {
        if ("failure" in answer) {
          setCandidates({ kind: "failed" });
          return;
        }
        const rows = answer.repositories.repositories
          .filter(
            (one) => one.access === GITHUB_ACCESS.TOKEN && !added.has(one.fullName.toLowerCase()),
          )
          .map((one): MenuRow => ({ id: one.fullName, label: one.fullName }));
        setCandidates({ kind: "read", rows });
      },
      () => setCandidates({ kind: "failed" }),
    );
  };
  const rows = candidates.kind === "read" ? candidates.rows : [];
  const note =
    candidates.kind === "reading"
      ? WORDS.READING
      : candidates.kind === "failed"
        ? WORDS.NOT_READ
        : rows.length === 0
          ? WORDS.NONE
          : undefined;
  return (
    <span className="settings-picker" ref={holder} {...placement} data-align={PICKER_ALIGN.END}>
      <Button
        ref={button}
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<PlusIcon aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!open) read();
          setOpen(!open);
        }}
      >
        {WORDS.ADD}
      </Button>
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={WORDS.ADD}
          className="settings-picker-menu"
          placeholder={WORDS.SEARCH}
          rows={rows}
          value={undefined}
          note={note}
          noMatch={WORDS.NO_MATCH}
          onPick={(id) => {
            close();
            onRefused(undefined);
            repositories.change(id, true).then(onRefused, () => undefined);
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && holder.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}

/** One token repository's row, inset under GitHub's: its owner's picture, its name marked Token, and Remove where the reader may. */
function TokenRepositoryRow({
  repository,
  onRemove,
}: {
  repository: WorkspaceTokenRepository;
  onRemove: () => Promise<string | undefined>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const [owner = repository.fullName] = repository.fullName.split("/");
  return (
    <SettingsRow
      indent={SETTINGS_ROW_INDENT.MARK}
      leading={
        <span className="settings-row-mark workspace-github-account-mark">
          <WorkspaceTile
            workspace={{
              id: `github:${owner}`,
              name: owner,
              pictureUrl: githubAccountPictureUrl(owner),
            }}
          />
        </span>
      }
      label={repository.fullName}
      adornment={<Badge>{WORDS.TOKEN}</Badge>}
      error={refusal}
    >
      {() =>
        repository.removable ? (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={busy}
            busyLabel={WORDS.REMOVING}
            onClick={() => {
              setBusy(true);
              setRefusal(undefined);
              onRemove().then(
                (refused) => {
                  setBusy(false);
                  setRefusal(refused);
                },
                () => setBusy(false),
              );
            }}
          >
            {WORDS.REMOVE}
          </Button>
        ) : null
      }
    </SettingsRow>
  );
}

/** Every token repository of the workspace, a row each, newest added first. */
export function TokenRepositoryRows({
  repositories,
}: {
  repositories: TokenRepositories;
}): React.JSX.Element {
  return (
    <>
      {repositories.listed.map((repository) => (
        <TokenRepositoryRow
          key={repository.fullName.toLowerCase()}
          repository={repository}
          onRemove={() => repositories.change(repository.fullName, false)}
        />
      ))}
    </>
  );
}
