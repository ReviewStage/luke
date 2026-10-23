# `@luke/ui`

Every shared React component, one app's alone included: the face and the glyphs traced from
`@luke/brand`'s generated art, every provider's brand mark, the chart, `cn`, and
the custom-property bridge a component's `style` reads; and the DOM-free view
models a page is drawn from (the site's account initials, activity calendar,
daily series, and animations roster).

- A component or CSS pattern duplicated elsewhere is folded into one here.
- A view model is a `.ts` module that imports no React, at a subpath of its
  own (`@luke/ui/<name>`), so an app that reads one never resolves React
  through it.
- A component takes its data and its callbacks as props. A shared context
  lands only when three components need the same door, because a context is a
  second way in that every app has to provide.
- Nothing here reaches an app: no `window.luke`, no `#shared/`, `#renderer/`,
  or `#main/` import. The desktop's bridge and the site's fetches stay in the
  app that mounts the component.
- A component draws with its own `luke-*` classes over the `--luke-*` tokens,
  never an app's Tailwind theme, whose `--color-*` each app maps to a
  different role, so no theme colour utility or `-(--name)` shorthand. The chart's frame is `src/chart/chart.css`.
- A module that pulls a heavy library gets a subpath of its own and stays out
  of the barrel: the chart is `@luke/ui/chart`, so recharts reaches only the
  bundle that draws a chart.
- A provider's mark is the brand's own vector, drawn once in
  `marks/provider-mark.tsx` for every app. A mark whose brand names one ink per
  ground wears an `integration-mark-*` class, and each app that mounts it sets
  those inks for the grounds it draws.
- This is the one workspace that builds controls from intrinsic elements.
  Everywhere else `anti-slop/no-raw-press-outside-ui` refuses a raw control,
  a pressable `role`, a press event, or a key event on a focusable element,
  with no disable comment allowed (root `AGENTS.md`'s Layout). When an app
  needs a press this package has no home for, add a component or an `as
  const` variant here, named for what the press does, with a catalog example
  and a test.
