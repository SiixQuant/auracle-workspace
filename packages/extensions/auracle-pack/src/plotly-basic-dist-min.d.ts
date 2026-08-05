/**
 * Minimal ambient typing for the `plotly.js-basic-dist-min` bundle — the pack
 * uses only the imperative `react`/`purge`/`Plots.resize` surface, and the
 * package ships no types. Kept deliberately narrow: a broader `@types/plotly.js`
 * would drag a heavy transitive type graph into a single-file extension build
 * for no runtime gain. Figures are assembled in `TearsheetChart` and passed as
 * plain data, so `unknown[]`/`unknown` here is enough for a type-safe call site.
 */
declare module 'plotly.js-basic-dist-min' {
  export function react(
    root: HTMLElement,
    data: unknown[],
    layout?: unknown,
    config?: unknown
  ): Promise<HTMLElement>;

  export function newPlot(
    root: HTMLElement,
    data: unknown[],
    layout?: unknown,
    config?: unknown
  ): Promise<HTMLElement>;

  export function purge(root: HTMLElement): void;

  export const Plots: { resize(root: HTMLElement): void };

  const Plotly: {
    react: typeof react;
    newPlot: typeof newPlot;
    purge: typeof purge;
    Plots: typeof Plots;
  };

  export default Plotly;
}
