export interface TextFoldOptions {
  /** The element that scrolls the page (TextFold: the window). */
  scroller: HTMLElement;
  doc: HTMLElement;
  ghosts: HTMLElement;
  /** The zoom bar (a segmented control); the reader fills it. */
  bar: HTMLElement;
  /** Names of levels 0 (Onderwerpen) to 4 (Volledig). */
  labels: readonly string[];
  level?: number;
  reduced?: boolean;
  onLevel?: (level: number) => void;
}
export interface TextFoldApi {
  setLevel(level: number): void;
  zoomBy(delta: number, point?: { x: number; y: number } | null): void;
  /** Same units with other ladders: the page morphs to them. False when the units differ. */
  setData(data: TextFoldPaper): boolean;
  destroy(): void;
  scrubTo(position: number): void;
  letGo(): void;
  readonly level: number;
  readonly pos: number;
  readonly staged: boolean;
  readonly busy: boolean;
  readonly keyframes: number[];
}
export interface TextFoldPaper {
  units: Record<string, unknown>;
  chunks: { id: string; num: string; title: string; level: number; html: string; units: string[]; lad: unknown }[];
  blocks: ({ k: 'h'; chunk: string } | { k: 'u'; u: string; chunk: string })[];
}
export function mountTextFold(root: HTMLElement, data: TextFoldPaper, options: TextFoldOptions): TextFoldApi;
