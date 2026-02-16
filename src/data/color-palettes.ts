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
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Diseño en blanco y negro con grises neutros. Fondo blanco o negro puro, texto en contraste máximo, acentos en gris medio. Estética sobria, editorial, tipo Apple.',
  },
  {
    id: 'warm-earth',
    name: 'Warm Earth',
    nameEs: 'Tierra Cálida',
    colors: ['#8B4513', '#DEB887', '#F5DEB3', '#2C1810'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Tonos tierra cálidos y naturales. Marrones ricos (#8B4513), beige arena (#DEB887), trigo claro (#F5DEB3) y marrón oscuro (#2C1810). Sensación orgánica, artesanal y premium.',
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    nameEs: 'Azul Oceánico',
    colors: ['#003B5C', '#00A5CF', '#E0F7FA'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Azules oceánicos frescos y profesionales. Azul profundo (#003B5C), azul brillante (#00A5CF) y celeste claro (#E0F7FA). Transmite confianza, frescura y modernidad.',
  },
  {
    id: 'sunset-bold',
    name: 'Sunset Bold',
    nameEs: 'Atardecer Vibrante',
    colors: ['#FF6B35', '#F7C948', '#1A1A2E'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Colores de atardecer vibrantes sobre base oscura. Naranja intenso (#FF6B35), amarillo dorado (#F7C948) y azul noche (#1A1A2E). Energético, llamativo y moderno.',
  },
  {
    id: 'pastel-soft',
    name: 'Pastel Soft',
    nameEs: 'Pastel Suave',
    colors: ['#FFB5E8', '#B5DEFF', '#E7FFAC', '#FFF5BA'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Pasteles suaves y amigables. Rosa pastel (#FFB5E8), azul pastel (#B5DEFF), verde pastel (#E7FFAC) y amarillo pastel (#FFF5BA). Estética suave, juvenil y acogedora.',
  },
  {
    id: 'neon-dark',
    name: 'Neon Dark',
    nameEs: 'Neón Oscuro',
    colors: ['#0D0D0D', '#39FF14', '#FF073A'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Base completamente oscura/negra (#0D0D0D) con acentos neón vibrantes: verde neón (#39FF14) y rojo neón (#FF073A). Estética futurista, tech, gaming o nocturna.',
  },
  {
    id: 'luxury-gold',
    name: 'Luxury Gold',
    nameEs: 'Dorado Elegante',
    colors: ['#1C1C1C', '#C9A96E', '#F5F5F0'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Negro elegante (#1C1C1C) con dorado (#C9A96E) y blanco hueso (#F5F5F0). Estética de lujo, sofisticada y premium. El dorado solo para acentos, tipografía destacada o bordes.',
  },
  {
    id: 'fresh-green',
    name: 'Fresh Green',
    nameEs: 'Verde Fresco',
    colors: ['#2D6A4F', '#95D5B2', '#FFFFFF'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Verdes frescos y naturales. Verde bosque (#2D6A4F), verde menta (#95D5B2) y blanco puro (#FFFFFF). Transmite salud, naturaleza, frescura y sostenibilidad.',
  },
  {
    id: 'coral-peach',
    name: 'Coral & Peach',
    nameEs: 'Coral y Melocotón',
    colors: ['#FF6F61', '#FFDAB9', '#FFF0E5'],
    promptEs: 'PALETA DE COLORES OBLIGATORIA: Coral vibrante (#FF6F61), melocotón (#FFDAB9) y crema rosado (#FFF0E5). Estética cálida, femenina, acogedora y moderna. Ideal para belleza, bienestar y lifestyle.',
  },
];

export function findPaletteById(id: string): ColorPalette | undefined {
  return COLOR_PALETTES.find(p => p.id === id);
}
