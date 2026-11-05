import {
  ACCOUNT_PROVIDER,
  type ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@repo/credentials/snapshot";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  appAuthors,
  coAuthorCredited,
  isCommitAuthor,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { SettingsSection } from "@repo/ui";
import { ACTOR_KIND, type Actor } from "@repo/ui/actor-model";
import { ActorStack } from "../actor-ref.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * commits-section.tsx -- the Account page's Commits group: who authors an agent's commits and opens its pull request, which the account carries across its Macs and the web.
 *
 * The one row is the schema's (`commitAuthor`), drawn by `SchemaSettingRows`
 * like every stored setting, so the settings search finds it too. Each of
 * its choices wears the faces GitHub shows on such a commit, the author's
 * first and the co-author's over it: the member by their GitHub picture, or
 * their letter where they signed in otherwise, and the product as GitHub
 * shows its App's bot.
 */

/** The product as GitHub shows its App's bot. */
const APP_ON_GITHUB: Actor = { kind: ACTOR_KIND.APP, onGitHub: true };

/** The faces a choice's commits show on GitHub, the author's first; none for a token no choice stores. */
function facesOf(member: Actor, token: string): readonly Actor[] {
  if (!isCommitAuthor(token)) return [];
  const [author, other] = appAuthors(token) ? [APP_ON_GITHUB, member] : [member, APP_ON_GITHUB];
  return coAuthorCredited(token) ? [author, other] : [author];
}

/** The signed-in member as their commits show them: by their GitHub picture, where their sign-in is GitHub's. */
function memberActor(
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>,
): Actor {
  return {
    kind: ACTOR_KIND.PERSON,
    userId: account.id ?? account.email,
    name: account.name ?? account.email,
    ...(account.provider === ACCOUNT_PROVIDER.GITHUB && account.pictureUrl !== undefined
      ? { pictureUrl: account.pictureUrl }
      : undefined),
    you: true,
  };
}

export function CommitsSection({
  view,
  writes,
  account,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
}): React.JSX.Element {
  const member = memberActor(account);
  const faces = (field: AppSettingField, token: string) =>
    field === APP_SETTING_SCHEMA.commitAuthor.field ? (
      <ActorStack actors={facesOf(member, token)} counted={false} />
    ) : undefined;
  return (
    <SettingsSection title="Commits">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.COMMITS}
        view={view}
        writes={writes}
        faces={faces}
      />
    </SettingsSection>
  );
}
