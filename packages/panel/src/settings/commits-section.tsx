import type { ACCOUNT_STATUS, AccountSnapshot } from "@repo/credentials/snapshot";
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
import { ACTOR_KIND, type Actor, accountActor } from "@repo/ui/actor-model";
import { ActorStack } from "../actor-ref.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

const APP_ON_GITHUB: Actor = { kind: ACTOR_KIND.APP, onGitHub: true };

function facesOf(member: Actor, token: string): readonly Actor[] {
  if (!isCommitAuthor(token)) return [];
  const [author, other] = appAuthors(token) ? [APP_ON_GITHUB, member] : [member, APP_ON_GITHUB];
  return coAuthorCredited(token) ? [author, other] : [author];
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
  const member = accountActor(account);
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
        faces={faces}
      />
    </SettingsSection>
  );
}
