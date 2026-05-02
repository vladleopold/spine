/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_OWNER?: string;
  readonly VITE_GITHUB_REPO?: string;
  readonly VITE_GITHUB_BRANCH?: string;
  readonly VITE_GITHUB_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "gifenc" {
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: number[][]; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: Record<string, unknown>): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
