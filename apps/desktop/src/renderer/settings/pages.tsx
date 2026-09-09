import { PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import {
  BackIcon,
  ChevronIcon,
  DisplayIcon,
  KeyboardIcon,
  PlugIcon,
  SpeakerIcon,
} from "@sidecar/panel";
import { SETTINGS_VIEW_COUNTED_AS } from "@sidecar/settings";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { SETTINGS_VIEW, type SettingsSubview, settingsNavRowId } from "../settings-views";
import { AttentionMark } from "./marks";

/**
 * What each page is called on the front page and at its own head. One table,
 * because the row that opens a page and the header that leaves it must never
 * disagree about its name. The name and the glyph are the whole row: what a
 * page holds is one press away, and a sentence under every name made the
 * front page read as prose rather than as places to go.
 */
export const SETTINGS_PAGE = {
  [SETTINGS_VIEW.VOICE]: {
    title: "Voice",
    icon: <SpeakerIcon />,
  },
  [SETTINGS_VIEW.APPEARANCE]: {
    title: "Appearance",
    icon: <DisplayIcon />,
  },
  [SETTINGS_VIEW.SHORTCUTS]: {
    title: "Keyboard shortcuts",
    icon: <KeyboardIcon />,
  },
  [SETTINGS_VIEW.CONNECTIONS]: {
    title: "Connections",
    icon: <PlugIcon />,
  },
};

/**
 * One front-page row per page: its glyph, its name, and the chevron that
 * promises a page rather than a control. The row is the whole press target,
 * the way a macOS settings row is. The one thing a row may add is the
 * attention mark: a state, not a sentence, saying the page holds something
 * that needs a hand before its feature can run — the mark's words are the
 * hover's, and the page itself is where they are explained.
 */
export function SettingsNavRow({
  view,
  onOpen,
  attention,
}: {
  view: SettingsSubview;
  onOpen: (view: SettingsSubview) => void;
  /** Why the page needs a hand, absent while nothing on it does. */
  attention?: string;
}): React.JSX.Element {
  const page = SETTINGS_PAGE[view];
  return (
    <button
      type="button"
      id={settingsNavRowId(view)}
      className="settings-nav"
      onClick={() => {
        window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SETTINGS_VIEW_OPEN, {
          settings_view: SETTINGS_VIEW_COUNTED_AS[view],
        });
        onOpen(view);
      }}
    >
      <span className="settings-nav-mark" aria-hidden="true">
        {page.icon}
      </span>
      <span className="settings-copy">
        <strong>{page.title}</strong>
      </span>
      {attention ? <AttentionMark note={attention} /> : null}
      <ChevronIcon />
    </button>
  );
}

/**
 * A page's head: the way back beside the page's own name. The back button
 * returns to the front page and nothing else — a page holds no unsaved state
 * of its own, so leaving one never needs a warning. A page whose settings can
 * be returned to their defaults ends the line with that reset, drawn only
 * while something on the page differs from them.
 */
export function SettingsPageHeader({
  view,
  onBack,
  backControl,
  reset,
}: {
  view: SettingsSubview;
  onBack: () => void;
  backControl: React.RefObject<HTMLButtonElement | null>;
  /** The page's reset control, absent while the page stands at its defaults. */
  reset?: React.JSX.Element;
}): React.JSX.Element {
  return (
    <div className="settings-header" style={cssCustomProperties({ "--row-index": 0 })}>
      <button
        type="button"
        ref={backControl}
        className="icon-button"
        aria-label="Back to Settings"
        title="Back"
        onClick={onBack}
      >
        <BackIcon />
      </button>
      <strong>{SETTINGS_PAGE[view].title}</strong>
      {reset}
    </div>
  );
}
