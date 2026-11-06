export const DIFF_LAYOUT = {
  UNIFIED: "unified",
  SPLIT: "split",
} as const;

export type DiffLayout = (typeof DIFF_LAYOUT)[keyof typeof DIFF_LAYOUT];

export const DIFF_INDICATORS = {
  CLASSIC: "classic",
  BARS: "bars",
  NONE: "none",
} as const;

export const INLINE_DIFF = {
  WORD_ALT: "word-alt",
  WORD: "word",
  CHAR: "char",
  NONE: "none",
} as const;

export const DIFF_FONT = {
  SF_MONO: "sf-mono",
  MENLO: "menlo",
  MONACO: "monaco",
  COURIER_NEW: "courier-new",
  ANDALE_MONO: "andale-mono",
} as const;

export const DIFF_FONT_SIZES = ["10", "11", "11.5", "12", "13", "14", "15"] as const;

export const DIFF_LINE_HEIGHT = {
  COMPACT: "compact",
  NORMAL: "normal",
  SPACIOUS: "spacious",
} as const;

export const DIFF_THEMES = {
  DARK: [
    { id: "andromeeda", label: "Andromeeda" },
    { id: "aurora-x", label: "Aurora X" },
    { id: "ayu-dark", label: "Ayu Dark" },
    { id: "ayu-mirage", label: "Ayu Mirage" },
    { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
    { id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
    { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
    { id: "dark-plus", label: "Dark Plus" },
    { id: "dracula", label: "Dracula Theme" },
    { id: "dracula-soft", label: "Dracula Theme Soft" },
    { id: "everforest-dark", label: "Everforest Dark" },
    { id: "github-dark", label: "GitHub Dark" },
    { id: "github-dark-default", label: "GitHub Dark Default" },
    { id: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
    { id: "github-dark-high-contrast", label: "GitHub Dark High Contrast" },
    { id: "gruvbox-dark-hard", label: "Gruvbox Dark Hard" },
    { id: "gruvbox-dark-medium", label: "Gruvbox Dark Medium" },
    { id: "gruvbox-dark-soft", label: "Gruvbox Dark Soft" },
    { id: "horizon", label: "Horizon" },
    { id: "houston", label: "Houston" },
    { id: "kanagawa-dragon", label: "Kanagawa Dragon" },
    { id: "kanagawa-wave", label: "Kanagawa Wave" },
    { id: "laserwave", label: "LaserWave" },
    { id: "material-theme", label: "Material Theme" },
    { id: "material-theme-darker", label: "Material Theme Darker" },
    { id: "material-theme-ocean", label: "Material Theme Ocean" },
    { id: "material-theme-palenight", label: "Material Theme Palenight" },
    { id: "min-dark", label: "Min Dark" },
    { id: "monokai", label: "Monokai" },
    { id: "night-owl", label: "Night Owl" },
    { id: "nord", label: "Nord" },
    { id: "one-dark-pro", label: "One Dark Pro" },
    { id: "pierre-dark", label: "Pierre Dark" },
    { id: "plastic", label: "Plastic" },
    { id: "poimandres", label: "Poimandres" },
    { id: "red", label: "Red" },
    { id: "rose-pine", label: "Rosé Pine" },
    { id: "rose-pine-moon", label: "Rosé Pine Moon" },
    { id: "slack-dark", label: "Slack Dark" },
    { id: "solarized-dark", label: "Solarized Dark" },
    { id: "synthwave-84", label: "Synthwave '84" },
    { id: "tokyo-night", label: "Tokyo Night" },
    { id: "vesper", label: "Vesper" },
    { id: "vitesse-black", label: "Vitesse Black" },
    { id: "vitesse-dark", label: "Vitesse Dark" },
  ],
  LIGHT: [
    { id: "ayu-light", label: "Ayu Light" },
    { id: "catppuccin-latte", label: "Catppuccin Latte" },
    { id: "everforest-light", label: "Everforest Light" },
    { id: "github-light", label: "GitHub Light" },
    { id: "github-light-default", label: "GitHub Light Default" },
    { id: "github-light-high-contrast", label: "GitHub Light High Contrast" },
    { id: "gruvbox-light-hard", label: "Gruvbox Light Hard" },
    { id: "gruvbox-light-medium", label: "Gruvbox Light Medium" },
    { id: "gruvbox-light-soft", label: "Gruvbox Light Soft" },
    { id: "horizon-bright", label: "Horizon Bright" },
    { id: "kanagawa-lotus", label: "Kanagawa Lotus" },
    { id: "light-plus", label: "Light Plus" },
    { id: "material-theme-lighter", label: "Material Theme Lighter" },
    { id: "min-light", label: "Min Light" },
    { id: "night-owl-light", label: "Night Owl Light" },
    { id: "one-light", label: "One Light" },
    { id: "pierre-light", label: "Pierre Light" },
    { id: "rose-pine-dawn", label: "Rosé Pine Dawn" },
    { id: "slack-ochin", label: "Slack Ochin" },
    { id: "snazzy-light", label: "Snazzy Light" },
    { id: "solarized-light", label: "Solarized Light" },
    { id: "vitesse-light", label: "Vitesse Light" },
  ],
} as const;

export const DIFF_LAYOUT_LABEL = {
  [DIFF_LAYOUT.UNIFIED]: "Unified",
  [DIFF_LAYOUT.SPLIT]: "Split",
} as const satisfies Record<DiffLayout, string>;

export const DIFF_INDICATORS_LABEL = {
  [DIFF_INDICATORS.CLASSIC]: "Classic (+/-)",
  [DIFF_INDICATORS.BARS]: "Bars",
  [DIFF_INDICATORS.NONE]: "None",
} as const satisfies Record<(typeof DIFF_INDICATORS)[keyof typeof DIFF_INDICATORS], string>;

export const INLINE_DIFF_LABEL = {
  [INLINE_DIFF.WORD_ALT]: "Words (smart)",
  [INLINE_DIFF.WORD]: "Words",
  [INLINE_DIFF.CHAR]: "Characters",
  [INLINE_DIFF.NONE]: "Off",
} as const satisfies Record<(typeof INLINE_DIFF)[keyof typeof INLINE_DIFF], string>;

export const DIFF_FONT_LABEL = {
  [DIFF_FONT.SF_MONO]: "SF Mono",
  [DIFF_FONT.MENLO]: "Menlo",
  [DIFF_FONT.MONACO]: "Monaco",
  [DIFF_FONT.COURIER_NEW]: "Courier New",
  [DIFF_FONT.ANDALE_MONO]: "Andale Mono",
} as const satisfies Record<(typeof DIFF_FONT)[keyof typeof DIFF_FONT], string>;

export const DIFF_LINE_HEIGHT_LABEL = {
  [DIFF_LINE_HEIGHT.COMPACT]: "Compact",
  [DIFF_LINE_HEIGHT.NORMAL]: "Normal",
  [DIFF_LINE_HEIGHT.SPACIOUS]: "Spacious",
} as const satisfies Record<(typeof DIFF_LINE_HEIGHT)[keyof typeof DIFF_LINE_HEIGHT], string>;
