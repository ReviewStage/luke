import { isLinkOpen, LINK_OPEN, LINK_OPEN_LABEL, LINK_OPEN_LIST } from "@repo/features/link-open";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { APP_SETTING_ID, isAppSettingId } from "@repo/wire/app-settings";
import { Schema } from "effect";
import {
  AGENT_ENTER,
  AGENT_ENTER_DETAIL,
  AGENT_ENTER_LABEL,
  AGENT_ENTER_LIST,
  isAgentEnter,
} from "./agent-enter.js";
import { HOST_CAPABILITY } from "./capabilities.js";
import {
  COMMIT_AUTHOR_DEFAULT,
  COMMIT_AUTHOR_DETAIL,
  COMMIT_AUTHOR_LABEL,
  COMMIT_AUTHOR_LIST,
  isCommitAuthor,
} from "./commit-author.js";
import {
  DIFF_FONT,
  DIFF_FONT_LABEL,
  DIFF_FONT_SIZES,
  DIFF_INDICATORS,
  DIFF_INDICATORS_LABEL,
  DIFF_LAYOUT,
  DIFF_LAYOUT_LABEL,
  DIFF_LINE_HEIGHT,
  DIFF_LINE_HEIGHT_LABEL,
  DIFF_THEMES,
  INLINE_DIFF,
  INLINE_DIFF_LABEL,
} from "./diff-view.js";
import {
  isMacCommandMode,
  MAC_COMMAND_MODE,
  MAC_COMMAND_MODE_LABEL,
  MAC_COMMAND_MODE_LIST,
} from "./mac-commands.js";
import {
  accountHiddenSetting,
  accountToggleSetting,
  buildToggleSetting,
  choiceSetting,
  optional,
  toggleSetting,
} from "./schema-builders.js";
import {
  SETTING_SECTION,
  SETTING_SIDE_EFFECT,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  type SettingsVisibility,
} from "./schema-types.js";
import { isSetupPlaceJson } from "./setup-place.js";
import { isTheme, THEME, THEME_LIST, type Theme } from "./theme.js";
import { isZoomPercent, ZOOM_ACTUAL_SIZE, ZOOM_PERCENTS } from "./zoom.js";

export {
  SETTING_SECTION,
  SETTING_SIDE_EFFECT,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  type SettingSection,
  type SettingSideEffectId,
  type SettingsPage,
  type SettingsResetScope,
} from "./schema-types.js";
export { APP_SETTING_ID, isAppSettingId };

export const DIFF_SETTING_GROUPS = [
  { section: SETTING_SECTION.DIFF, title: "Diff" },
  { section: SETTING_SECTION.LINES, title: "Lines" },
  { section: SETTING_SECTION.TEXT, title: "Text" },
] as const;

export type DiffSettingSection = (typeof DIFF_SETTING_GROUPS)[number]["section"];

function themeOptionLabel(theme: Theme): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function oneOf<Value extends string>(values: readonly Value[]) {
  const reads = Schema.is(Schema.Literals(values));
  return (value: UnparsedWireValue): value is Value => reads(value);
}

const DIFF_LAYOUT_LIST = Object.values(DIFF_LAYOUT);
const DIFF_INDICATORS_LIST = Object.values(DIFF_INDICATORS);
const INLINE_DIFF_LIST = Object.values(INLINE_DIFF);
const DIFF_FONT_LIST = Object.values(DIFF_FONT);
const DIFF_LINE_HEIGHT_LIST = Object.values(DIFF_LINE_HEIGHT);
const DIFF_DARK_THEME_LIST = DIFF_THEMES.DARK.map((theme) => theme.id);
const DIFF_LIGHT_THEME_LIST = DIFF_THEMES.LIGHT.map((theme) => theme.id);

function themeLabel(themes: readonly { readonly id: string; readonly label: string }[]) {
  return (id: string): string => themes.find((theme) => theme.id === id)?.label ?? id;
}

function macCommandModeGuard(value: UnparsedWireValue) {
  if (value === true) return optional(MAC_COMMAND_MODE.ASK, isMacCommandMode);
  if (value === false) return optional(MAC_COMMAND_MODE.NEVER, isMacCommandMode);
  return optional(value, isMacCommandMode);
}

const microphoneRouteDrawn = (view: SettingsVisibility): boolean =>
  view.capabilities.includes(HOST_CAPABILITY.MICROPHONE);

const desktopAppDrawn = (view: SettingsVisibility): boolean =>
  view.capabilities.includes(HOST_CAPABILITY.DESKTOP_APP);

const accountDrawn = (view: SettingsVisibility): boolean => view.accountDrawn;

export const APP_SETTING_SCHEMA = {
  theme: choiceSetting({
    field: "theme",
    id: APP_SETTING_ID.THEME,
    label: "Theme",
    values: THEME_LIST,
    token: (theme) => theme,
    optionLabel: themeOptionLabel,
    guard: (value: UnparsedWireValue) => optional(value, isTheme),
    default: THEME.SYSTEM,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 5,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  zoom: choiceSetting({
    field: "zoom",
    id: APP_SETTING_ID.ZOOM,
    label: "Zoom",
    detail: "⌘+ and ⌘− step through these sizes, and ⌘0 returns to 100%.",
    values: ZOOM_PERCENTS,
    token: (percent) => String(percent),
    optionLabel: (percent) => `${percent}%`,
    guard: (value: UnparsedWireValue) => optional(value, isZoomPercent),
    default: ZOOM_ACTUAL_SIZE,
    page: SETTINGS_PAGE.APPEARANCE,
    order: 7,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    visible: desktopAppDrawn,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  openAtLogin: toggleSetting({
    field: "openAtLogin",
    id: APP_SETTING_ID.OPEN_AT_LOGIN,
    label: `Open ${PRODUCT_NAME} at login`,
    default: true,
    page: SETTINGS_PAGE.THIS_MAC,
    section: SETTING_SECTION.STARTUP,
    order: 1,
    visible: desktopAppDrawn,
    sideEffect: SETTING_SIDE_EFFECT.LOGIN_ITEM,
  }),
  macCommands: choiceSetting({
    field: "macCommands",
    id: APP_SETTING_ID.MAC_COMMANDS,
    label: "Let agents run commands on this Mac",
    values: MAC_COMMAND_MODE_LIST,
    token: (mode) => mode,
    optionLabel: (mode) => MAC_COMMAND_MODE_LABEL[mode],
    guard: macCommandModeGuard,
    default: MAC_COMMAND_MODE.ASK,
    page: SETTINGS_PAGE.THIS_MAC,
    order: 2,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  linkOpen: choiceSetting({
    field: "linkOpen",
    id: APP_SETTING_ID.LINK_OPEN,
    label: `Open ${PRODUCT_NAME} links in`,
    values: LINK_OPEN_LIST,
    token: (choice) => choice,
    optionLabel: (choice) => LINK_OPEN_LABEL[choice],
    guard: (value: UnparsedWireValue) => optional(value, isLinkOpen),
    default: LINK_OPEN.BROWSER,
    page: SETTINGS_PAGE.ACCOUNT,
    section: SETTING_SECTION.LINKS,
    order: 300,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: accountDrawn,
  }),
  openNewTask: toggleSetting({
    field: "openNewTask",
    id: APP_SETTING_ID.OPEN_NEW_TASK,
    label: "Open a task once it starts",
    default: true,
    page: SETTINGS_PAGE.ACCOUNT,
    section: SETTING_SECTION.TASKS,
    order: 305,
    visible: accountDrawn,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  usageData: buildToggleSetting({
    field: "usageData",
    id: APP_SETTING_ID.USAGE_DATA,
    label: "Share usage data",
    default: true,
    unpackagedDefault: false,
    page: SETTINGS_PAGE.ACCOUNT,
    section: SETTING_SECTION.PRIVACY,
    order: 310,
    visible: accountDrawn,
    sideEffect: SETTING_SIDE_EFFECT.USAGE_DATA,
  }),
  preferBuiltInMicrophone: toggleSetting({
    field: "preferBuiltInMicrophone",
    id: APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE,
    label: "Prefer the Mac's microphone",
    default: true,
    page: SETTINGS_PAGE.THIS_MAC,
    section: SETTING_SECTION.MICROPHONE,
    order: 110,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: microphoneRouteDrawn,
  }),
  agentEnter: choiceSetting({
    field: "agentEnter",
    id: APP_SETTING_ID.AGENT_ENTER,
    label: "Follow-up behavior",
    detail: (settings) =>
      AGENT_ENTER_DETAIL[
        settings("agentEnter") === AGENT_ENTER.QUEUE ? AGENT_ENTER.QUEUE : AGENT_ENTER.STEER
      ],
    values: AGENT_ENTER_LIST,
    token: (choice) => choice,
    optionLabel: (choice) => AGENT_ENTER_LABEL[choice],
    guard: (value: UnparsedWireValue) => optional(value, isAgentEnter),
    default: AGENT_ENTER.STEER,
    page: SETTINGS_PAGE.ACCOUNT,
    section: SETTING_SECTION.COMPOSER,
    order: 400,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: accountDrawn,
  }),
  commitAuthor: choiceSetting({
    field: "commitAuthor",
    id: APP_SETTING_ID.COMMIT_AUTHOR,
    label: "Commit author",
    detail: (settings) => {
      const chosen = settings("commitAuthor");
      return COMMIT_AUTHOR_DETAIL[isCommitAuthor(chosen) ? chosen : COMMIT_AUTHOR_DEFAULT];
    },
    values: COMMIT_AUTHOR_LIST,
    token: (choice) => choice,
    optionLabel: (choice) => COMMIT_AUTHOR_LABEL[choice],
    guard: (value: UnparsedWireValue) => optional(value, isCommitAuthor),
    default: COMMIT_AUTHOR_DEFAULT,
    page: SETTINGS_PAGE.ACCOUNT,
    section: SETTING_SECTION.COMMITS,
    order: 450,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: accountDrawn,
  }),
  setupFinished: accountToggleSetting({
    field: "setupFinished",
    id: APP_SETTING_ID.SETUP_FINISHED,
    label: "Setup finished",
    default: false,
    page: SETTINGS_PAGE.ACCOUNT,
    order: 900,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    visible: () => false,
  }),
  setupPlace: accountHiddenSetting({
    field: "setupPlace",
    id: APP_SETTING_ID.SETUP_PLACE,
    page: SETTINGS_PAGE.ACCOUNT,
    order: 910,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
    guard: isSetupPlaceJson,
  }),
  lineNumbers: toggleSetting({
    field: "lineNumbers",
    id: APP_SETTING_ID.LINE_NUMBERS,
    label: "Line numbers",
    default: true,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.LINES,
    order: 225,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  wordWrap: toggleSetting({
    field: "wordWrap",
    id: APP_SETTING_ID.WORD_WRAP,
    label: "Word wrap",
    default: true,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.LINES,
    order: 220,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffLayout: choiceSetting({
    field: "diffLayout",
    id: APP_SETTING_ID.DIFF_LAYOUT,
    label: "Layout",
    detail: "A diff too narrow to split is drawn unified.",
    values: DIFF_LAYOUT_LIST,
    token: (layout) => layout,
    optionLabel: (layout) => DIFF_LAYOUT_LABEL[layout],
    guard: (value: UnparsedWireValue) => optional(value, oneOf(DIFF_LAYOUT_LIST)),
    default: DIFF_LAYOUT.UNIFIED,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.DIFF,
    order: 200,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffIndicators: choiceSetting({
    field: "diffIndicators",
    id: APP_SETTING_ID.DIFF_INDICATORS,
    label: "Indicators",
    values: DIFF_INDICATORS_LIST,
    token: (indicators) => indicators,
    optionLabel: (indicators) => DIFF_INDICATORS_LABEL[indicators],
    guard: (value: UnparsedWireValue) => optional(value, oneOf(DIFF_INDICATORS_LIST)),
    default: DIFF_INDICATORS.BARS,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.DIFF,
    order: 210,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  inlineDiff: choiceSetting({
    field: "inlineDiff",
    id: APP_SETTING_ID.DIFF_INLINE,
    label: "Changed words",
    detail: "Off tints the line alone.",
    values: INLINE_DIFF_LIST,
    token: (inline) => inline,
    optionLabel: (inline) => INLINE_DIFF_LABEL[inline],
    guard: (value: UnparsedWireValue) => optional(value, oneOf(INLINE_DIFF_LIST)),
    default: INLINE_DIFF.WORD_ALT,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.DIFF,
    order: 205,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffBackgrounds: toggleSetting({
    field: "diffBackgrounds",
    id: APP_SETTING_ID.DIFF_BACKGROUNDS,
    label: "Backgrounds",
    default: true,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.DIFF,
    order: 215,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffDarkTheme: choiceSetting({
    field: "diffDarkTheme",
    id: APP_SETTING_ID.DIFF_DARK_THEME,
    label: "Dark theme",
    values: DIFF_DARK_THEME_LIST,
    token: (theme) => theme,
    optionLabel: themeLabel(DIFF_THEMES.DARK),
    guard: (value: UnparsedWireValue) => optional(value, oneOf(DIFF_DARK_THEME_LIST)),
    default: "github-dark-default",
    search: "Search themes",
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.TEXT,
    order: 235,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffLightTheme: choiceSetting({
    field: "diffLightTheme",
    id: APP_SETTING_ID.DIFF_LIGHT_THEME,
    label: "Light theme",
    values: DIFF_LIGHT_THEME_LIST,
    token: (theme) => theme,
    optionLabel: themeLabel(DIFF_THEMES.LIGHT),
    guard: (value: UnparsedWireValue) => optional(value, oneOf(DIFF_LIGHT_THEME_LIST)),
    default: "github-light-default",
    search: "Search themes",
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.TEXT,
    order: 240,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffFont: choiceSetting({
    field: "diffFont",
    id: APP_SETTING_ID.DIFF_FONT,
    label: "Font",
    values: DIFF_FONT_LIST,
    token: (font) => font,
    optionLabel: (font) => DIFF_FONT_LABEL[font],
    guard: (value: UnparsedWireValue) => optional(value, oneOf(DIFF_FONT_LIST)),
    default: DIFF_FONT.SF_MONO,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.TEXT,
    order: 245,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffFontSize: choiceSetting({
    field: "diffFontSize",
    id: APP_SETTING_ID.DIFF_FONT_SIZE,
    label: "Font size",
    values: DIFF_FONT_SIZES,
    token: (size) => size,
    optionLabel: (size) => `${size}px`,
    guard: (value: UnparsedWireValue) => optional(value, oneOf(DIFF_FONT_SIZES)),
    default: "11.5",
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.TEXT,
    order: 250,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffLineHeight: choiceSetting({
    field: "diffLineHeight",
    id: APP_SETTING_ID.DIFF_LINE_HEIGHT,
    label: "Line height",
    values: DIFF_LINE_HEIGHT_LIST,
    token: (height) => height,
    optionLabel: (height) => DIFF_LINE_HEIGHT_LABEL[height],
    guard: (value: UnparsedWireValue) => optional(value, oneOf(DIFF_LINE_HEIGHT_LIST)),
    default: DIFF_LINE_HEIGHT.NORMAL,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.TEXT,
    order: 255,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffLigatures: toggleSetting({
    field: "diffLigatures",
    id: APP_SETTING_ID.DIFF_LIGATURES,
    label: "Ligatures",
    default: false,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.TEXT,
    order: 260,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
  diffMinimizeComments: toggleSetting({
    field: "diffMinimizeComments",
    id: APP_SETTING_ID.DIFF_MINIMIZE_COMMENTS,
    label: "Minimize inline comments",
    default: false,
    page: SETTINGS_PAGE.APPEARANCE,
    section: SETTING_SECTION.LINES,
    order: 230,
    resetScope: SETTINGS_RESET_SCOPE.APPEARANCE,
    sideEffect: SETTING_SIDE_EFFECT.NONE,
  }),
} as const;
