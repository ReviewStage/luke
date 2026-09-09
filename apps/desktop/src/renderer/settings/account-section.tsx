import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_PROVIDER, type ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { UserIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";

import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-search";
import { useConfirm, useConfirmGroup } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";

/**
 * Who is signed in, and the two ways out of that. It sits at the foot of the
 * front page: signing out and deleting are done once or never. Both ways out
 * ask before they act.
 */
export function AccountSection({
  account,
  onSignOut,
  onDeleteAccount,
  panelOpen,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<ActionResult>;
  panelOpen: boolean;
}): React.JSX.Element {
  // Signing out asks first, the way deleting a key does: getting back in costs
  // a whole trip through the browser, so the button asks and only the answer
  // acts. Deleting asks harder still — it erases the account at the service,
  // which no sign-in brings back. Both ways out end in the same signed-out
  // place, so at most one of them may be standing: the group is what withdraws
  // the other's question when one is raised.
  const ways = useConfirmGroup();
  const surroundings = { subject: true, surfaceOpen: panelOpen };
  // The sign-out cannot be refused, so its answer is the accepted one every
  // confirming action reports through.
  const signOut = useConfirm(
    surroundings,
    async () => {
      await onSignOut();
      return { status: ACTION_RESULT_STATUS.ACCEPTED } satisfies ActionResult;
    },
    ways,
  );
  const deletion = useConfirm(surroundings, onDeleteAccount, ways);

  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 4 })}>
      <h2>
        <UserIcon />
        Account
      </h2>
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.SIGN_OUT)}>
        <span className="settings-copy account-identity">
          {/* The provider's own picture of the person, when their identity
              carried one from a host this build pins — otherwise the same
              glyph the heading wears, so the line never shows a broken image. */}
          {account.pictureUrl ? (
            <img
              className="account-avatar"
              src={account.pictureUrl}
              alt=""
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ) : (
            <span className="account-avatar account-avatar-fallback" aria-hidden="true">
              <UserIcon />
            </span>
          )}
          <span className="account-words">
            <span className="settings-name">
              <strong>{account.email}</strong>
            </span>
            <small>
              Signed in with {account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}
            </small>
          </span>
        </span>
        <ConfirmSwap
          question={`Sign out of ${account.email}?`}
          stage={signOut.stage}
          verb="Sign out"
          running="Signing out…"
          onKeep={signOut.keep}
          onAct={signOut.run}
        >
          <button
            type="button"
            className="quiet-button account-signout"
            disabled={signOut.busy}
            /* The ellipsis is the promise that it asks first. */
            title="Sign out…"
            onClick={signOut.ask}
          >
            Sign out
          </button>
        </ConfirmSwap>
      </div>
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.DELETE_ACCOUNT)}>
        <span className="settings-copy">
          <strong>Delete account</strong>
        </span>
        <ConfirmSwap
          question={`Delete the account ${account.email}? This cannot be undone.`}
          stage={deletion.stage}
          verb="Delete account"
          running="Deleting…"
          onKeep={deletion.keep}
          onAct={deletion.run}
        >
          <button
            type="button"
            className="quiet-button account-delete"
            disabled={deletion.busy}
            /* The ellipsis is the promise that it asks first. */
            title="Delete account…"
            onClick={deletion.ask}
          >
            Delete
          </button>
        </ConfirmSwap>
      </div>
      {/* Only the delete answers with why: a refusal keeps the account and says
          so under the row it was asked on. */}
      {deletion.rejection ? (
        <p className="error-message" role="alert">
          {deletion.rejection}
        </p>
      ) : null}
    </section>
  );
}
