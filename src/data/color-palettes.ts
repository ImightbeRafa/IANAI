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