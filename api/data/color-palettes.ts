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
  { id: 'minimal-bw', promptEs: 'PALETA DE COLORES OBLIGATORIA: Diseño en blanco y negro con grises neutros. Fondo blanco o negro puro, texto en contraste máximo, acentos en gris medio. Estética sobria, editorial, tipo Apple.' },
  { id: 'warm-earth', promptEs: 'PALETA DE COLORES OBLIGATORIA: Tonos tierra cálidos y naturales. Marrones ricos (#8B4513), beige arena (#DEB887), trigo claro (#F5DEB3) y marrón oscuro (#2C1810). Sensación orgánica, artesanal y premium.' },
  { id: 'ocean-blue', promptEs: 'PALETA DE COLORES OBLIGATORIA: Azules oceánicos frescos y profesionales. Azul profundo (#003B5C), azul brillante (#00A5CF) y celeste claro (#E0F7FA). Transmite confianza, frescura y modernidad.' },
  { id: 'sunset-bold', promptEs: 'PALETA DE COLORES OBLIGATORIA: Colores de atardecer vibrantes sobre base oscura. Naranja intenso (#FF6B35), amarillo dorado (#F7C948) y azul noche (#1A1A2E). Energético, llamativo y moderno.' },
  { id: 'pastel-soft', promptEs: 'PALETA DE COLORES OBLIGATORIA: Pasteles suaves y amigables. Rosa pastel (#FFB5E8), azul pastel (#B5DEFF), verde pastel (#E7FFAC) y amarillo pastel (#FFF5BA). Estética suave, juvenil y acogedora.' },
  { id: 'neon-dark', promptEs: 'PALETA DE COLORES OBLIGATORIA: Base completamente oscura/negra (#0D0D0D) con acentos neón vibrantes: verde neón (#39FF14) y rojo neón (#FF073A). Estética futurista, tech, gaming o nocturna.' },
  { id: 'luxury-gold', promptEs: 'PALETA DE COLORES OBLIGATORIA: Negro elegante (#1C1C1C) con dorado (#C9A96E) y blanco hueso (#F5F5F0). Estética de lujo, sofisticada y premium. El dorado solo para acentos, tipografía destacada o bordes.' },
  { id: 'fresh-green', promptEs: 'PALETA DE COLORES OBLIGATORIA: Verdes frescos y naturales. Verde bosque (#2D6A4F), verde menta (#95D5B2) y blanco puro (#FFFFFF). Transmite salud, naturaleza, frescura y sostenibilidad.' },
  { id: 'coral-peach', promptEs: 'PALETA DE COLORES OBLIGATORIA: Coral vibrante (#FF6F61), melocotón (#FFDAB9) y crema rosado (#FFF0E5). Estética cálida, femenina, acogedora y moderna. Ideal para belleza, bienestar y lifestyle.' },
];

export function findColorPaletteById(id: string): ColorPaletteAPI | undefined {
  return COLOR_PALETTES.find(p => p.id === id);
}
