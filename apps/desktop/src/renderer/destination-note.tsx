import { ExternalIcon } from "@sidecar/panel";

/**
 * One sentence whose link is its destination: the lead, then the linked words
 * that open the page, a full stop, and the trail if there is one. Every
 * place the panel says where to fetch a credential — the settings editor and
 * the key slot — draws this one shape, so the wording cannot drift apart.
 *
 * A button, not an anchor: the renderer has no browser to navigate, and the
 * main process owns every address — a key page is opened by provider id.
 */
/** Where to go, and what else has to be true of the page when it gets there. */
export interface Destination {
  lead: string;
  destination: string;
  trail?: string;
}

export function DestinationNote({
  lead,
  destination,
  trail,
  disabled,
  onOpen,
}: Destination & {
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <small className="settings-note">
      {lead}{" "}
      <button type="button" className="link-button" disabled={disabled} onClick={onOpen}>
        {destination}
        <ExternalIcon />
      </button>
      .{trail ? ` ${trail}` : null}
    </small>
  );
}
