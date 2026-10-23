import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { Badge, ProviderMark } from "@luke/ui";
import { RepositoryPicture } from "./repository-picture.js";
import type { MenuRow } from "./searchable-menu.js";

/**
 * repository-row.tsx -- a repository as every list and menu draws it: its owner's picture, its name, its owner muted after it, found by its whole `owner/name`.
 *
 * The repository chip's menu drew this first, and the Tasks page's filter and
 * Settings' repository picker draw it the same way now, so a repository
 * reads alike wherever it is listed or picked. A row names the repository
 * first and its owner muted after it, since the owner is the part rows most
 * often share and a narrow menu cuts the end of a row; a search matches the
 * whole `owner/name` all the same. A repository the developer's own GitHub
 * token reaches rather than the App is marked Token after its owner.
 */

/** The mark beside a repository the developer's own GitHub token reaches rather than the App. */
const TOKEN_LABEL = "Token";

/** A repository's row words: its name, and its owner as the muted detail; a name with no owner is its label alone. */
export function repositoryWords(fullName: string): { label: string; detail?: string } {
  const slash = fullName.indexOf("/");
  if (slash <= 0) return { label: fullName };
  return { label: fullName.slice(slash + 1), detail: fullName.slice(0, slash) };
}

/** A repository's row in a searched menu: its owner's picture, its name, its owner and, where the token reaches it, the Token mark; found by `owner/name`. */
export function repositoryMenuRow(fullName: string, pictures: boolean, token = false): MenuRow {
  const { label, detail } = repositoryWords(fullName);
  return {
    id: fullName,
    label,
    detail: token ? (
      <>
        {detail} <Badge>{TOKEN_LABEL}</Badge>
      </>
    ) : (
      detail
    ),
    terms: [fullName],
    icon: (
      <RepositoryPicture
        repository={fullName}
        pictures={pictures}
        fallback={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
      />
    ),
  };
}
