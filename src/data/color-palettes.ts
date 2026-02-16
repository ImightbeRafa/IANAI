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
  {
    id: 'minimal-bw',
    name: 'Minimal B&W',
    nameEs: 'Minimalista B&N',
    colors: ['#000000', '#FFFFFF', '#888888'],
    promptEs: 'USA SOLO ESTOS COLORES: negro #000000, blanco #FFFFFF, gris #888888. Sin otros colores.',
  },
  {
    id: 'warm-earth',
    name: 'Warm Earth',
    nameEs: 'Tierra Cálida',
    colors: ['#8B4513', '#DEB887', '#F5DEB3', '#2C1810'],
    promptEs: 'USA SOLO ESTOS COLORES: marrón #8B4513, beige #DEB887, trigo #F5DEB3, marrón oscuro #2C1810. Tonos tierra cálidos.',
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    nameEs: 'Azul Oceánico',
    colors: ['#003B5C', '#00A5CF', '#E0F7FA'],
    promptEs: 'USA SOLO ESTOS COLORES: azul profundo #003B5C, azul brillante #00A5CF, celeste #E0F7FA. Tonos azules oceánicos.',
  },
  {
    id: 'sunset-bold',
    name: 'Sunset Bold',
    nameEs: 'Atardecer Vibrante',
    colors: ['#FF6B35', '#F7C948', '#1A1A2E'],
    promptEs: 'USA SOLO ESTOS COLORES: naranja #FF6B35, amarillo dorado #F7C948, azul noche #1A1A2E. Colores de atardecer vibrantes.',
  },
  {
    id: 'pastel-soft',
    name: 'Pastel Soft',
    nameEs: 'Pastel Suave',
    colors: ['#FFB5E8', '#B5DEFF', '#E7FFAC', '#FFF5BA'],
    promptEs: 'USA SOLO ESTOS COLORES: rosa #FFB5E8, azul #B5DEFF, verde #E7FFAC, amarillo #FFF5BA. Pasteles suaves.',
  },
  {
    id: 'neon-dark',
    name: 'Neon Dark',
    nameEs: 'Neón Oscuro',
    colors: ['#0D0D0D', '#39FF14', '#FF073A'],
    promptEs: 'USA SOLO ESTOS COLORES: negro #0D0D0D, verde neón #39FF14, rojo neón #FF073A. Fondo oscuro con acentos neón.',
  },
  {
    id: 'luxury-gold',
    name: 'Luxury Gold',
    nameEs: 'Dorado Elegante',
    colors: ['#1C1C1C', '#C9A96E', '#F5F5F0'],
    promptEs: 'USA SOLO ESTOS COLORES: negro #1C1C1C, dorado #C9A96E, blanco hueso #F5F5F0. Estética de lujo.',
  },
  {
    id: 'fresh-green',
    name: 'Fresh Green',
    nameEs: 'Verde Fresco',
    colors: ['#2D6A4F', '#95D5B2', '#FFFFFF'],
    promptEs: 'USA SOLO ESTOS COLORES: verde bosque #2D6A4F, verde menta #95D5B2, blanco #FFFFFF. Verdes frescos naturales.',
  },
  {
    id: 'coral-peach',
    name: 'Coral & Peach',
    nameEs: 'Coral y Melocotón',
    colors: ['#FF6F61', '#FFDAB9', '#FFF0E5'],
    promptEs: 'USA SOLO ESTOS COLORES: coral #FF6F61, melocotón #FFDAB9, crema #FFF0E5. Tonos cálidos coral.',
  },
];

export function findPaletteById(id: string): ColorPalette | undefined {
  return COLOR_PALETTES.find(p => p.id === id);
}
