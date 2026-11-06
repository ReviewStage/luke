import { PRODUCT_NAME } from "@repo/features/product-name";
import { type ExperimentChoices, HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import {
  SETTINGS_PAGE_GROUP,
  SETTINGS_PAGE_GROUPS,
  SETTINGS_VIEW,
  type SettingsPageGroup,
  type SettingsView,
} from "@repo/settings/settings-views";
import { DisplayIcon, KeyboardIcon, LaptopIcon, PlugIcon, ProductMark } from "@repo/ui";
import { FlaskConicalIcon, GLYPH, InfoIcon } from "@repo/ui/icons";
import { settingsPageShown } from "./settings-rows.js";

interface SettingsPage {
  readonly title: string;
  readonly icon: React.JSX.Element;
}

const SETTINGS_PAGE = {
  [SETTINGS_VIEW.ACCOUNT]: { title: "Account", icon: <GLYPH.PERSON /> },
  [SETTINGS_VIEW.WORKSPACE]: { title: "Workspace", icon: <GLYPH.PEOPLE /> },
  [SETTINGS_VIEW.AGENTS]: { title: "Agents", icon: <GLYPH.AGENT /> },
  [SETTINGS_VIEW.HOSTS]: { title: "Hosts", icon: <GLYPH.HOST /> },
  [SETTINGS_VIEW.INTEGRATIONS]: { title: "Integrations", icon: <PlugIcon /> },
  [SETTINGS_VIEW.MCP]: { title: `${PRODUCT_NAME} MCP`, icon: <ProductMark small glyph /> },
  [SETTINGS_VIEW.CLI]: { title: `${PRODUCT_NAME} CLI`, icon: <GLYPH.TERMINAL /> },
  [SETTINGS_VIEW.SKILLS]: { title: "Skills", icon: <GLYPH.SKILL /> },
  [SETTINGS_VIEW.MEMORY]: { title: "Memory", icon: <GLYPH.MEMORY /> },
  [SETTINGS_VIEW.APPEARANCE]: { title: "Appearance", icon: <DisplayIcon /> },
  [SETTINGS_VIEW.THIS_MAC]: { title: "This Mac", icon: <LaptopIcon /> },
  [SETTINGS_VIEW.EXPERIMENTAL]: { title: "Experimental", icon: <FlaskConicalIcon /> },
  [SETTINGS_VIEW.ABOUT]: { title: "About", icon: <InfoIcon /> },
  [SETTINGS_VIEW.SHORTCUTS]: { title: "Keyboard shortcuts", icon: <KeyboardIcon /> },
} satisfies Record<SettingsView, SettingsPage>;

export const WORKSPACE_CONNECTIONS = "Workspace connections";

const SETTINGS_GROUP_HEADING = {
  [SETTINGS_PAGE_GROUP.WORKSPACE]: "Workspace",
  [SETTINGS_PAGE_GROUP.ACCOUNT]: "Account",
  [SETTINGS_PAGE_GROUP.THIS_MAC]: "This Mac",
} satisfies Record<SettingsPageGroup, string>;

const THIS_DEVICE_HEADING = "This device";

export function settingsPageOf(view: SettingsView): SettingsPage {
  return SETTINGS_PAGE[view];
}

export function shownSettingsPageGroups(
  capabilities: readonly HostCapability[],
  experiments: ExperimentChoices,
): readonly { readonly group: SettingsPageGroup; readonly pages: readonly SettingsView[] }[] {
  return SETTINGS_PAGE_GROUPS.map(({ group, pages }) => ({
    group,
    pages: pages.filter((page) => settingsPageShown(page, capabilities, experiments)),
  })).filter(({ pages }) => pages.length > 0);
}

export function settingsGroupHeadingOf(
  group: SettingsPageGroup,
  capabilities: readonly HostCapability[],
): string {
  if (
    group === SETTINGS_PAGE_GROUP.THIS_MAC &&
    !capabilities.includes(HOST_CAPABILITY.DESKTOP_APP)
  ) {
    return THIS_DEVICE_HEADING;
  }
  return SETTINGS_GROUP_HEADING[group];
}
