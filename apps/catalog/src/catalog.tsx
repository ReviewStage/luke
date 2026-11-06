import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  DENSITY,
  type Density,
  PROFILE,
  type Profile,
  TEXT_ELEMENT,
  TEXT_FIELD_TYPE,
  TEXT_VARIANT,
  Text,
  TextField,
  THEME,
  type Theme,
} from "@repo/ui";
import { useState } from "react";
import { EXAMPLES, type Example } from "./examples";

export interface CatalogView {
  readonly example: Example;
  readonly profile: Profile;
  readonly theme: Theme;
  readonly density: Density | undefined;
  readonly width: number | undefined;
}

const THEMES = [THEME.DARK, THEME.LIGHT] as const;
const PROFILES = [PROFILE.DESKTOP, PROFILE.WEB] as const;
const DENSITIES = [undefined, DENSITY.COMPACT] as const;
const WIDTHS = [undefined, 390, 768] as const;
const WIDTH_RANGE = { min: 240, max: 2560 } as const;

function widthOf(value: string | null): number | undefined {
  if (value === null || !/^\d+(\.\d+)?$/.test(value)) return undefined;
  const width = Math.round(Number(value));
  return width >= WIDTH_RANGE.min && width <= WIDTH_RANGE.max ? width : undefined;
}

function oneOf<Value extends string>(
  value: string | null,
  known: readonly Value[],
  fallback: Value,
): Value {
  return known.find((candidate) => candidate === value) ?? fallback;
}

export function readView(search: string): CatalogView {
  const params = new URLSearchParams(search);
  const first = EXAMPLES[0];
  if (first === undefined) throw new Error("The catalog has no examples");
  const profile = oneOf(params.get("profile"), PROFILES, PROFILE.DESKTOP);
  return {
    example: EXAMPLES.find((example) => example.id === params.get("example")) ?? first,
    profile,
    theme: oneOf(params.get("theme"), THEMES, THEME.DARK),
    density:
      profile === PROFILE.WEB
        ? DENSITIES.find((candidate) => candidate === params.get("density"))
        : undefined,
    width: widthOf(params.get("width")),
  };
}

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

function WidthField({ view }: { view: CatalogView }): React.JSX.Element {
  const [draft, setDraft] = useState(view.width);
  const carried = [...new URLSearchParams(hrefOf({ ...view, width: undefined }))];
  return (
    <form className="catalog-width" method="get" noValidate>
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

function ExampleFrame({
  example,
  width,
}: {
  example: Example;
  width: number | undefined;
}): React.JSX.Element {
  return (
    <main className="catalog-example">
      <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE} className="catalog-example-title">
        {example.title}
      </Text>
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
        <p className="catalog-index-title">{PRODUCT_NAME} catalog</p>
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
