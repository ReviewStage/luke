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
  ForwardIcon,
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
  PROVIDER_MARK_SIZE,
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
import { CatalogSection } from "../section";

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
  ForwardIcon,
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
      <CatalogSection id="artwork-face" title="Face">
        <div className="catalog-face">
          <WingFace />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-glyphs" title="Glyphs">
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
      </CatalogSection>
      <CatalogSection id="artwork-marks" title="Provider marks">
        <ul className="catalog-tiles">
          {Object.values(MARK_PROVIDER).map((provider) => (
            <li key={provider} className="catalog-tile">
              <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ROW} />
              <span className="catalog-tile-name">{provider}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
    </>
  );
}

export const ARTWORK_EXAMPLE: Example = { id: "artwork", title: "Artwork", Render: Artwork };
