import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  DENSITY,
  type Density,
  PROFILE,
  type Profile,
  TEXT_FIELD_TYPE,
  TextField,
  THEME,
  type Theme,
} from "@luke/ui";
import { useState } from "react";
import { EXAMPLES, type Example } from "./examples";

/**
 * catalog.tsx -- the catalog's page: the index of examples, the profile and
 * theme they are drawn at, and the one example chosen.
 *
 * The address is the whole state, `?example=<id>&profile=<p>&theme=<t>`,
 * `&density=compact` for the site's compact surface, and `&width=<px>` to
 * frame the example at that many pixels, a phone's 390 say, so
 * every view is a link a reader can share and a test can open, and the
 * shell keeps no state of its own. The profile and theme are the document's
 * own attributes (`main.tsx`), as they are on an app's root, so whatever an
 * example portals into the body is drawn at them too.
 *
 * The width frames the example, not the window: a component's own
 * `@container` rules answer the frame, which is how every shared component
 * answers its width, while a media query still reads the window and the
 * device, which no page can force. So `(hover: none)` and `(pointer: coarse)`
 * are seen only on a touch device or under a browser's touch emulation
 * (Playwright's `hasTouch`), never by setting a width here.
 */

/** What the catalog shows: one example, at one profile, in one theme, compact where the site's is asked for. */
export interface CatalogView {
  readonly example: Example;
  readonly profile: Profile;
  readonly theme: Theme;
  readonly density: Density | undefined;
  /** The width in pixels the example is framed at; the stage's own where left out. */
  readonly width: number | undefined;
}

/** The themes a reader picks between; `system` is the desktop's own and follows whatever the machine is set to. */
const THEMES = [THEME.DARK, THEME.LIGHT] as const;
const PROFILES = [PROFILE.DESKTOP, PROFILE.WEB] as const;
/** The site's densities: its own, which no attribute names, and the compact one. */
const DENSITIES = [undefined, DENSITY.COMPACT] as const;
/** The widths offered at a click: the stage's own, a phone's, and a tablet's in portrait. */
const WIDTHS = [undefined, 390, 768] as const;
/** The narrowest and widest frame an address may ask for, so a typo draws a frame rather than a sliver or a runaway. */
const WIDTH_RANGE = { min: 240, max: 2560 } as const;

/** The width `value` asks for, if it is a whole number of pixels in range. */
function widthOf(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const width = Number(value);
  return width >= WIDTH_RANGE.min && width <= WIDTH_RANGE.max ? width : undefined;
}

/** `value` if it is one of `known`, else `fallback`. */
function oneOf<Value extends string>(
  value: string | null,
  known: readonly Value[],
  fallback: Value,
): Value {
  return known.find((candidate) => candidate === value) ?? fallback;
}

/** The view an address asks for, the first example at the desktop's dark where it names none. */
export function readView(search: string): CatalogView {
  const params = new URLSearchParams(search);
  const first = EXAMPLES[0];
  if (first === undefined) throw new Error("The catalog has no examples");
  const profile = oneOf(params.get("profile"), PROFILES, PROFILE.DESKTOP);
  return {
    example: EXAMPLES.find((example) => example.id === params.get("example")) ?? first,
    profile,
    theme: oneOf(params.get("theme"), THEMES, THEME.DARK),
    // The desktop has one density, so an address asking it for another gets its own.
    density:
      profile === PROFILE.WEB
        ? DENSITIES.find((candidate) => candidate === params.get("density"))
        : undefined,
    width: widthOf(params.get("width")),
  };
}

/** The address of `view`. */
function hrefOf(view: CatalogView): string {
  const params = new URLSearchParams({
    example: view.example.id,
    profile: view.profile,
    theme: view.theme,
  });
  if (view.density !== undefined) params.set("density", view.density);
  if (view.width !== undefined) params.set("width", String(view.width));
  return `?${params.toString()}`;
}

/** One way to change one part of the view, current where it is the view's own. */
function ViewLink({
  view,
  current,
  children,
}: {
  view: CatalogView;
  current: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a className="catalog-link" href={hrefOf(view)} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}

/**
 * The width field: a form the browser submits as a plain GET, by Enter or by
 * Apply, carrying the rest of the view along as hidden fields, so the address
 * stays the whole state; the field holds only the draft being typed.
 */
function WidthField({ view }: { view: CatalogView }): React.JSX.Element {
  const [draft, setDraft] = useState(view.width);
  const carried = [...new URLSearchParams(hrefOf({ ...view, width: undefined }))];
  return (
    <form className="catalog-width" method="get">
      {carried.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <TextField
        type={TEXT_FIELD_TYPE.NUMBER}
        name="width"
        label="Width in pixels"
        placeholder="Width"
        value={draft}
        onChange={setDraft}
      />
      <Button type={BUTTON_TYPE.SUBMIT} variant={BUTTON_VARIANT.OUTLINE}>
        Apply
      </Button>
    </form>
  );
}

/** One example under its heading, as the page draws it, framed at the view's width where it names one. */
function ExampleFrame({
  example,
  width,
}: {
  example: Example;
  width: number | undefined;
}): React.JSX.Element {
  return (
    <main className="catalog-example">
      <h1 className="catalog-example-title">{example.title}</h1>
      {width === undefined ? (
        <example.Render />
      ) : (
        <div
          className="catalog-width-frame"
          data-catalog-width={width}
          style={{ inlineSize: width }}
        >
          <example.Render />
        </div>
      )}
    </main>
  );
}

export function Catalog({ view }: { view: CatalogView }): React.JSX.Element {
  const { example, profile, theme, density, width } = view;
  return (
    <div className="catalog">
      <nav className="catalog-index" aria-label="Examples">
        <p className="catalog-index-title">Luke catalog</p>
        <ul>
          {EXAMPLES.map((entry) => (
            <li key={entry.id}>
              <ViewLink view={{ ...view, example: entry }} current={entry === example}>
                {entry.title}
              </ViewLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="catalog-stage">
        <div className="catalog-toolbar">
          <ul aria-label="Profile">
            {PROFILES.map((option) => (
              <li key={option}>
                <ViewLink view={{ ...view, profile: option }} current={option === profile}>
                  {option}
                </ViewLink>
              </li>
            ))}
          </ul>
          {profile === PROFILE.WEB ? (
            <ul aria-label="Density">
              {DENSITIES.map((option) => (
                <li key={option ?? "regular"}>
                  <ViewLink view={{ ...view, density: option }} current={option === density}>
                    {option ?? "regular"}
                  </ViewLink>
                </li>
              ))}
            </ul>
          ) : null}
          <ul aria-label="Theme">
            {THEMES.map((option) => (
              <li key={option}>
                <ViewLink view={{ ...view, theme: option }} current={option === theme}>
                  {option}
                </ViewLink>
              </li>
            ))}
          </ul>
          <ul aria-label="Width">
            {WIDTHS.map((option) => (
              <li key={option ?? "auto"}>
                <ViewLink view={{ ...view, width: option }} current={option === width}>
                  {option ?? "auto"}
                </ViewLink>
              </li>
            ))}
          </ul>
          <WidthField view={view} />
        </div>
        <ExampleFrame example={example} width={width} />
      </div>
    </div>
  );
}
