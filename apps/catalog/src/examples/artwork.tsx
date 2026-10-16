import {
  AgentPlaceholderIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BackIcon,
  BoardIcon,
  CallIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CodeIcon,
  CollapseIcon,
  ComposeIcon,
  CopyIcon,
  DisplayIcon,
  DocumentIcon,
  DownloadIcon,
  EllipsisIcon,
  ExpandIcon,
  ExternalIcon,
  FolderIcon,
  GearIcon,
  ImageIcon,
  KeyboardIcon,
  LaptopIcon,
  MARK_PROVIDER,
  McpIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PencilIcon,
  PinIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  ProviderMark,
  RemoveIcon,
  ResetIcon,
  ReturnIcon,
  SearchIcon,
  SidebarIcon,
  SidePanelIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  TerminalIcon,
  TrashIcon,
  UnarchiveIcon,
  UnpinIcon,
  UpdateIcon,
  UserIcon,
  VideoIcon,
  VideoOffIcon,
  WingFace,
} from "@luke/ui";
import type { Example } from "../examples";

/**
 * artwork.tsx -- the production artwork `@luke/ui` draws from `@luke/brand`'s
 * generated sources: Luke's face at rest, every glyph, and every provider's
 * mark, each drawn from the package itself rather than from a copy.
 */

/** Every glyph `face/glyphs.tsx` draws, by the name it is exported under. */
const GLYPHS = Object.entries({
  AgentPlaceholderIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BackIcon,
  BoardIcon,
  CallIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CodeIcon,
  CollapseIcon,
  ComposeIcon,
  CopyIcon,
  DisplayIcon,
  DocumentIcon,
  DownloadIcon,
  EllipsisIcon,
  ExpandIcon,
  ExternalIcon,
  FolderIcon,
  GearIcon,
  ImageIcon,
  KeyboardIcon,
  LaptopIcon,
  McpIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PencilIcon,
  PinIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  RemoveIcon,
  ResetIcon,
  ReturnIcon,
  SearchIcon,
  SidePanelIcon,
  SidebarIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  TerminalIcon,
  TrashIcon,
  UnarchiveIcon,
  UnpinIcon,
  UpdateIcon,
  UserIcon,
  VideoIcon,
  VideoOffIcon,
});

function Artwork(): React.JSX.Element {
  return (
    <>
      <section className="catalog-section" aria-labelledby="artwork-face">
        <h2 id="artwork-face">Face</h2>
        <div className="catalog-face">
          <WingFace />
        </div>
      </section>
      <section className="catalog-section" aria-labelledby="artwork-glyphs">
        <h2 id="artwork-glyphs">Glyphs</h2>
        <ul className="catalog-tiles">
          {GLYPHS.map(([name, Glyph]) => (
            <li key={name} className="catalog-tile">
              <span className="catalog-glyph">
                <Glyph />
              </span>
              <span className="catalog-tile-name">{name}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="catalog-section" aria-labelledby="artwork-marks">
        <h2 id="artwork-marks">Provider marks</h2>
        <ul className="catalog-tiles">
          {Object.values(MARK_PROVIDER).map((provider) => (
            <li key={provider} className="catalog-tile">
              <ProviderMark provider={provider} className="catalog-mark" />
              <span className="catalog-tile-name">{provider}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export const ARTWORK_EXAMPLE: Example = { id: "artwork", title: "Artwork", Render: Artwork };
