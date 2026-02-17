/**
 * Server-side copy of color palettes for API use.
 * Mirrors src/data/color-palettes.ts — only includes fields needed by the API.
 */

export interface ColorPaletteAPI {
  id: string;
  promptEs: string;
}

export const COLOR_PALETTES: ColorPaletteAPI[] = [
  { id: 'auto', promptEs: '' },
];

export function findColorPaletteById(id: string): ColorPaletteAPI | undefined {
  return COLOR_PALETTES.find(p => p.id === id);
}
