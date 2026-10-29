// react-compiler.d.mts -- the React Compiler trial's transform, typed for the TypeScript configs that wrap it (react-compiler.mjs).

/** What the compiler tells a logger of each component or hook it reads (`babel-plugin-react-compiler`'s `LoggerEvent`). */
export interface ReactCompilerLogger {
  logEvent(
    filename: string | null,
    event: { readonly kind: string } & Record<string, unknown>,
  ): void;
}

/** The source map Babel writes beside the module, in the shape a bundler reads one. */
export interface ReactCompilerSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourceRoot?: string;
  sourcesContent?: string[];
}

export const REACT_COMPILER_SCOPE: RegExp;
export const REACT_COMPILER_LEFT_AS_WRITTEN: readonly string[];
export function inReactCompilerScope(file: string): boolean;
export function compileReact(
  code: string,
  file: string,
  options?: { logger?: ReactCompilerLogger; inlineMap?: boolean },
): Promise<{ code: string; map: ReactCompilerSourceMap | null }>;

/** The transform as a Vite plugin, typed by the part of Vite's plugin shape it fills, so the declaration takes no dependency on Vite. */
export function reactCompilerVite(): {
  name: string;
  enforce: "pre";
  transform(
    code: string,
    id: string,
  ): Promise<{ code: string; map: ReactCompilerSourceMap | null }> | undefined;
};
