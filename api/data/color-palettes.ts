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
  { id: 'minimal-bw', promptEs: 'USA SOLO ESTOS COLORES: negro #000000, blanco #FFFFFF, gris #888888. Sin otros colores.' },
  { id: 'warm-earth', promptEs: 'USA SOLO ESTOS COLORES: marrón #8B4513, beige #DEB887, trigo #F5DEB3, marrón oscuro #2C1810. Tonos tierra cálidos.' },
  { id: 'ocean-blue', promptEs: 'USA SOLO ESTOS COLORES: azul profundo #003B5C, azul brillante #00A5CF, celeste #E0F7FA. Tonos azules oceánicos.' },
  { id: 'sunset-bold', promptEs: 'USA SOLO ESTOS COLORES: naranja #FF6B35, amarillo dorado #F7C948, azul noche #1A1A2E. Colores de atardecer vibrantes.' },
  { id: 'pastel-soft', promptEs: 'USA SOLO ESTOS COLORES: rosa #FFB5E8, azul #B5DEFF, verde #E7FFAC, amarillo #FFF5BA. Pasteles suaves.' },
  { id: 'neon-dark', promptEs: 'USA SOLO ESTOS COLORES: negro #0D0D0D, verde neón #39FF14, rojo neón #FF073A. Fondo oscuro con acentos neón.' },
  { id: 'luxury-gold', promptEs: 'USA SOLO ESTOS COLORES: negro #1C1C1C, dorado #C9A96E, blanco hueso #F5F5F0. Estética de lujo.' },
  { id: 'fresh-green', promptEs: 'USA SOLO ESTOS COLORES: verde bosque #2D6A4F, verde menta #95D5B2, blanco #FFFFFF. Verdes frescos naturales.' },
  { id: 'coral-peach', promptEs: 'USA SOLO ESTOS COLORES: coral #FF6F61, melocotón #FFDAB9, crema #FFF0E5. Tonos cálidos coral.' },
];

export function findColorPaletteById(id: string): ColorPaletteAPI | undefined {
  return COLOR_PALETTES.find(p => p.id === id);
}
