import {
  type ComponentProps,
  type ComponentType,
  isValidElement,
  type ReactNode,
  useState,
} from "react";
import { pulseOnPress } from "../../press-pulse.js";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../shadcn/breadcrumb.js";
import { useDisclosure } from "../../use-disclosure.js";
import { BUTTON_VARIANT } from "../button/button.js";
import { FoldingButton, type FoldingButtonHint } from "../folding-button/folding-button.js";
import { dropBelowStart, Menu, type MenuAction, useMenu } from "../menu/menu.js";
import {
  ClippedLine,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  type OneLineEnd,
} from "../one-line/clipped-line.js";
import { Tooltip } from "../tooltip/hint.js";
import { useCrumbFold } from "./crumb-fold.js";

export const BREADCRUMBS_VARIANT = {
  CAPTION: "caption",
  TITLE: "title",
} as const;

export type BreadcrumbsVariant = (typeof BREADCRUMBS_VARIANT)[keyof typeof BREADCRUMBS_VARIANT];

export const BREADCRUMB_SHOWN = {
  ALWAYS: "always",
  WIDE: "wide",
  WIDE_OR_NARROW: "wide-or-narrow",
  NARROW: "narrow",
  NARROWEST: "narrowest",
} as const;

export type BreadcrumbShown = (typeof BREADCRUMB_SHOWN)[keyof typeof BREADCRUMB_SHOWN];

export const BREADCRUMB_POPUP = {
  DIALOG: "dialog",
  MENU: "menu",
} as const;

export type BreadcrumbPopup = (typeof BREADCRUMB_POPUP)[keyof typeof BREADCRUMB_POPUP];

export type BreadcrumbHint = ComponentType<
  ComponentProps<FoldingButtonHint> & { card?: ReactNode | undefined }
>;

interface CrumbBase {
  readonly label: string;
  readonly onPress?: ((crumb: HTMLElement) => void) | undefined;
  readonly shownAt?: BreadcrumbShown | undefined;
}

interface PathCrumb extends CrumbBase {
  readonly icon?: undefined;
  readonly glyph?: ReactNode;
  readonly card?: ReactNode;
  readonly name?: string | undefined;
  readonly hint?: string | undefined;
  readonly current?: boolean | undefined;
  readonly popup?: BreadcrumbPopup | undefined;
  readonly expanded?: boolean | undefined;
  readonly shown?: boolean | undefined;
  readonly end?: OneLineEnd | undefined;
  readonly kept?: boolean | undefined;
  readonly fixed?: boolean | undefined;
}

interface WayBackCrumb extends CrumbBase {
  readonly icon: ReactNode;
  readonly onPress: (crumb: HTMLElement) => void;
  readonly glyph?: undefined;
  readonly card?: undefined;
  readonly name?: undefined;
  readonly hint?: undefined;
  readonly current?: undefined;
  readonly popup?: undefined;
  readonly expanded?: undefined;
  readonly shown?: undefined;
  readonly end?: undefined;
  readonly kept?: undefined;
  readonly fixed?: undefined;
}

export type Crumb = PathCrumb | WayBackCrumb;

const SHOWN_WIDTHS = {
  [BREADCRUMB_SHOWN.ALWAYS]: { wide: true, narrow: true, narrowest: true },
  [BREADCRUMB_SHOWN.WIDE]: { wide: true, narrow: false, narrowest: false },
  [BREADCRUMB_SHOWN.WIDE_OR_NARROW]: { wide: true, narrow: true, narrowest: false },
  [BREADCRUMB_SHOWN.NARROW]: { wide: false, narrow: true, narrowest: false },
  [BREADCRUMB_SHOWN.NARROWEST]: { wide: false, narrow: false, narrowest: true },
} as const;

interface Widths {
  readonly wide: boolean;
  readonly narrow: boolean;
  readonly narrowest: boolean;
}

const LOOK = {
  [BREADCRUMBS_VARIANT.CAPTION]: {
    nav: "text-caption",
    list: "",
    item: "",
    wordsItem: "",
    separator: "flex-none items-center text-muted-foreground [&>svg]:size-breadcrumb-chevron",
    words: "",
  },
  [BREADCRUMBS_VARIANT.TITLE]: {
    nav: "text-muted-foreground",
    list: "gap-breadcrumb-gap",
    item: "flex-none gap-breadcrumb-gap",
    wordsItem: "min-w-0 flex-initial gap-breadcrumb-gap",
    separator: "flex-none items-center [&>svg]:size-breadcrumb-title-chevron",
    words: "text-dialog font-dialog",
  },
} as const;

function Chevron({ at, variant }: { at: Widths; variant: BreadcrumbsVariant }): React.JSX.Element {
  return (
    <BreadcrumbSeparator
      className={`ui-breadcrumb-separator ${LOOK[variant].separator}`}
      data-wide={at.wide}
      data-narrow={at.narrow}
      data-narrowest={at.narrowest}
    />
  );
}

function chevronBefore(crumbs: readonly Crumb[], at: number): Widths | undefined {
  const own = SHOWN_WIDTHS[crumbs[at]?.shownAt ?? BREADCRUMB_SHOWN.ALWAYS];
  const before = crumbs
    .slice(0, at)
    .filter((each) => each.shown !== false)
    .map((each) => SHOWN_WIDTHS[each.shownAt ?? BREADCRUMB_SHOWN.ALWAYS]);
  const led = {
    wide: before.some((widths) => widths.wide),
    narrow: before.some((widths) => widths.narrow),
    narrowest: before.some((widths) => widths.narrowest),
  };
  if (!(own.wide && led.wide) && !(own.narrow && led.narrow) && !(own.narrowest && led.narrowest)) {
    return undefined;
  }
  return {
    wide: !own.wide || led.wide,
    narrow: !own.narrow || led.narrow,
    narrowest: !own.narrowest || led.narrowest,
  };
}

function CrumbChevron({
  at,
  variant,
}: {
  at: Widths | undefined;
  variant: BreadcrumbsVariant;
}): React.JSX.Element | null {
  return at === undefined ? null : <Chevron at={at} variant={variant} />;
}

function CrumbFace({
  glyph,
  label,
  end = ONE_LINE_END.FADE,
}: {
  glyph: ReactNode;
  label: string;
  end?: OneLineEnd | undefined;
}): React.JSX.Element {
  return (
    <>
      {glyph === undefined ? null : (
        <span className="flex flex-none [&_svg]:size-control-icon" aria-hidden="true">
          {glyph}
        </span>
      )}
      <ClippedLine
        className="ui-breadcrumb-label min-w-0 overflow-hidden whitespace-nowrap"
        as={ONE_LINE_ELEMENT.SPAN}
        end={end}
        words={label}
      >
        {label}
      </ClippedLine>
    </>
  );
}

function CrumbControl({
  crumb,
  variant,
  hint: Hint,
}: {
  crumb: Crumb;
  variant: BreadcrumbsVariant;
  hint: BreadcrumbHint;
}): React.JSX.Element {
  const { label, icon, onPress } = crumb;
  const current = crumb.current === true ? "page" : undefined;
  if (icon !== undefined) {
    return (
      <FoldingButton
        label={label}
        icon={icon}
        variant={BUTTON_VARIANT.QUIET}
        hint={Hint}
        onClick={onPress === undefined ? undefined : (event) => onPress(event.currentTarget)}
      />
    );
  }
  const control =
    onPress === undefined ? (
      <BreadcrumbPage
        className={`flex min-w-0 items-center gap-breadcrumb-gap ${LOOK[variant].words}`}
        aria-current={current}
      >
        <CrumbFace glyph={crumb.glyph} label={label} end={crumb.end} />
      </BreadcrumbPage>
    ) : (
      <BreadcrumbLink
        render={<button type="button" />}
        aria-label={crumb.name}
        aria-current={current}
        aria-haspopup={crumb.popup}
        aria-expanded={crumb.popup === undefined ? undefined : crumb.expanded === true}
        onClick={pulseOnPress((event) => onPress(event.currentTarget))}
      >
        <CrumbFace glyph={crumb.glyph} label={label} end={crumb.end} />
      </BreadcrumbLink>
    );
  return crumb.hint === undefined && crumb.card === undefined ? (
    control
  ) : (
    <Hint label={crumb.hint} card={crumb.card}>
      {control}
    </Hint>
  );
}

const CRUMB_MOTION = {
  ARRIVING: "arriving",
  LEAVING: "leaving",
} as const;

function CrumbItem({
  crumb,
  chevron,
  legible,
  whole,
  variant,
  hint,
}: {
  crumb: Crumb;
  chevron: Widths | undefined;
  legible: boolean;
  whole: boolean;
  variant: BreadcrumbsVariant;
  hint: BreadcrumbHint;
}): React.JSX.Element | null {
  const shown = crumb.shown ?? true;
  const presence = useDisclosure(shown);
  const [was, setWas] = useState(shown);
  const [arriving, setArriving] = useState(false);
  if (shown !== was) {
    setWas(shown);
    setArriving(shown);
  }
  if (!presence.mounted) return null;
  const motion = presence.leaving
    ? CRUMB_MOTION.LEAVING
    : arriving
      ? CRUMB_MOTION.ARRIVING
      : undefined;
  const words = crumb.icon === undefined && crumb.onPress === undefined;
  return (
    <BreadcrumbItem
      ref={presence.ref}
      className={words ? LOOK[variant].wordsItem : LOOK[variant].item}
      data-shown={crumb.shownAt ?? BREADCRUMB_SHOWN.ALWAYS}
      data-words={words}
      data-fixed={crumb.fixed === true ? "true" : undefined}
      data-legible={legible ? "true" : undefined}
      data-whole={whole ? "true" : undefined}
      data-motion={motion}
      inert={presence.leaving}
    >
      <CrumbChevron at={chevron} variant={variant} />
      <CrumbControl crumb={crumb} variant={variant} hint={hint} />
    </BreadcrumbItem>
  );
}

export function Breadcrumbs({
  label,
  crumbs,
  variant = BREADCRUMBS_VARIANT.CAPTION,
  hint = Tooltip,
}: {
  label: string;
  crumbs: readonly Crumb[];
  variant?: BreadcrumbsVariant;
  hint?: BreadcrumbHint | undefined;
}): React.JSX.Element {
  const [measured, drawn, hidden] = useCrumbFold(crumbs);
  const menu = useMenu(hidden.length > 0);
  const shown = drawn.map((each) =>
    each.folded
      ? {
          ...each,
          crumb: {
            label: each.crumb.label,
            name: each.crumb.name,
            hint: each.crumb.hint,
            popup: BREADCRUMB_POPUP.MENU,
            expanded: menu.open !== undefined,
            onPress: (opener: HTMLElement) =>
              menu.open === undefined
                ? menu.show(dropBelowStart(opener), opener)
                : menu.close(true),
          } satisfies Crumb,
        }
      : each,
  );
  const path = shown.map((each) => each.crumb);
  const opener = menu.open?.opener;
  const hiddenRows: MenuAction[] = hidden.map((crumb) => ({
    label: crumb.label,
    ...(isValidElement(crumb.glyph) ? { icon: crumb.glyph as React.JSX.Element } : {}),
    disabled: crumb.onPress === undefined,
    onSelect: () => {
      if (opener !== undefined) crumb.onPress?.(opener);
    },
  }));
  return (
    <Breadcrumb
      ref={variant === BREADCRUMBS_VARIANT.CAPTION ? measured : undefined}
      className={`ui-breadcrumbs relative min-w-0 flex-initial overflow-clip ${LOOK[variant].nav}`}
      data-variant={variant}
      aria-label={label}
    >
      <BreadcrumbList className={LOOK[variant].list}>
        {shown.map((each, at) => (
          <CrumbItem
            key={each.key}
            crumb={each.crumb}
            chevron={chevronBefore(path, at)}
            legible={each.legible}
            whole={each.whole}
            variant={variant}
            hint={hint}
          />
        ))}
      </BreadcrumbList>
      {menu.drawn === undefined ? null : (
        <Menu
          label="Earlier in the path"
          menu={menu.drawn}
          groups={[hiddenRows]}
          onClose={menu.close}
        />
      )}
    </Breadcrumb>
  );
}

export function BreadcrumbBar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="@container/ui-breadcrumb-bar flex min-w-0 flex-auto items-center gap-[inherit]">
      {children}
    </div>
  );
}
