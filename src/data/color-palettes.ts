export interface ColorPalette {
  id: string;
  name: string;
  nameEs: string;
  colors: string[];
  promptEs: string;
}

export const COLOR_PALETTES: ColorPalette[] = [
  {
    id: 'auto',
    name: 'Auto',
    nameEs: 'Automático',
    colors: [],
    promptEs: '',
  },
];

export function findPaletteById(id: string): ColorPalette | undefined {
  return COLOR_PALETTES.find(p => p.id === id);
}
