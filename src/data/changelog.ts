export type ChangeCategory = 'feature' | 'fix' | 'improvement' | 'rework'
export type RoadmapStatus = 'planned' | 'in_progress' | 'beta' | 'done'

export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  items: {
    category: ChangeCategory
    text: { es: string; en: string }
  }[]
}

export interface RoadmapItem {
  status: RoadmapStatus
  text: { es: string; en: string }
  eta?: string
}

export interface StatusAlert {
  active: boolean
  text: { es: string; en: string }
  severity: 'info' | 'warning' | 'error'
}

// =============================================
// STATUS ALERT — show if a feature is having issues
// Set active: false to hide
// =============================================
export const STATUS_ALERT: StatusAlert = {
  active: false,
  text: {
    es: 'La generación de imágenes puede tardar más de lo normal. Estamos trabajando en ello.',
    en: 'Image generation may be slower than usual. We are working on it.'
  },
  severity: 'info'
}

// =============================================
// ROADMAP — what's coming next
// =============================================
export const ROADMAP: RoadmapItem[] = [
  {
    status: 'done',
    text: {
      es: 'Brand Kit — identidad visual y tonal aplicada automáticamente',
      en: 'Brand Kit — auto-applied visual and tonal identity'
    }
  },
  {
    status: 'in_progress',
    text: {
      es: 'Fondos temáticos — mármol, madera, naturaleza, navidad y más como presets rápidos',
      en: 'Background theme presets — marble, wood, nature, Christmas and more as quick picks'
    },
    eta: 'Mar 2026'
  },
  {
    status: 'planned',
    text: {
      es: 'Catálogo de producto — genera sets consistentes de fotos para toda tu línea',
      en: 'Product catalog — generate consistent photo sets for your entire product line'
    }
  },
  {
    status: 'planned',
    text: {
      es: 'Analíticas de rendimiento — métricas de tus guiones y posts',
      en: 'Performance analytics — metrics for your scripts and posts'
    }
  },
  {
    status: 'planned',
    text: {
      es: 'Plantillas de guiones — guarda y reutiliza estructuras que funcionan',
      en: 'Script templates — save and reuse structures that work'
    }
  }
]

// =============================================
// CHANGELOG — add new entries at the TOP
// =============================================
//
// EDITORIAL GUIDELINES (for developers / AI assistants):
// 1. NEVER include admin-only changes (admin dashboard, admin routes, internal tooling).
// 2. NEVER expose security fixes in detail — omit them entirely or use vague
//    user-facing language like "Mejoras generales de estabilidad" / "General stability improvements".
// 3. Only list changes that are visible or meaningful to end users.
// 4. Keep language simple, non-technical, and benefit-oriented.
// 5. Do NOT mention internal architecture, database migrations, or RLS policies.
//
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.1.12',
    date: '2026-09-04',
    items: [
      {
        category: 'feature',
        text: {
          es: 'El chat es el inicio para todos. Entrá y pedí guiones, posts y fotos en un solo lugar. El panel clásico sigue en Configuración si lo necesitás.',
          en: 'Chat is home for everyone. Open it and ask for scripts, posts, and photos in one place. Classic remains under Settings if you need it.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'La primera vez que abrís el chat en producción recibís 100 créditos de bienvenida para probar. Solo una vez.',
          en: 'The first time you open chat in production you get 100 welcome credits to try it. Once only.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Si el chat no tiene oferta, Guiones, Post, Foto y Pack se ven apagados (Elegí oferta) y te llevan a Ofertas. Pack no arranca vacío.',
          en: 'If the chat has no offer, Scripts, Post, Photo, and Pack look off (Choose offer) and take you to Offers. Pack does not start empty.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'En el chat, la línea de modelo de imagen dice Poco texto en vez de Hard.',
          en: 'In chat, the image model line says Short copy instead of Hard.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Si pedís un post y elegís Producto, la hoja sigue diciendo Post. Foto queda para el botón Foto.',
          en: 'If you start a post and pick Product, the sheet stays titled Post. Photo stays on the Photo button.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'En guiones paso 3 ves la mezcla de CTAs y Generar (apagado hasta elegir). El primero toma todas las versiones; el segundo le saca 1.',
          en: 'Script step 3 shows the CTA mix and Generate (off until you pick). First pick takes every version; a second type steals 1.',
        },
      },
    ],
  },
  {
    version: '0.1.11',
    date: '2026-09-03',
    items: [
      {
        category: 'feature',
        text: {
          es: 'En guiones podés mezclar CTAs: unos a la web, otros a mensaje, o sin CTA, con un número al lado de cada opción. Los créditos se cotizan igual que hoy.',
          en: 'Script CTAs can mix: some to the website, some to message, or none, with a count next to each option. Credits quote the same as today.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'En Plan y facturación ves tu historial de uso: qué se generó, cuándo, créditos y si salió bien o falló. Solo el tuyo.',
          en: 'Plan & Billing now shows your usage history: what ran, when, credits, and success vs fail. Yours only.',
        },
      },
    ],
  },
  {
    version: '0.1.10',
    date: '2026-08-27',
    items: [
      {
        category: 'fix',
        text: {
          es: 'Posts cuadrados con Grok: prompt corto y útil (sin ensayos largos del sistema) para que un guion breve genere la imagen. Si falla por longitud, el aviso es en español.',
          en: 'Square Grok posts: short useful prompts (no giant system essays) so a brief script can generate an image. Length failures stay in Spanish.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Posts con Grok: el formato va por aspect ratio (incluye 1:1) y el prompt se limita a 8000 caracteres para evitar fallos. Si se pasa del límite, el error sale en español.',
          en: 'Grok posts: format uses aspect ratio (including 1:1) and prompts are capped at 8000 characters to avoid failures. Over-limit errors show in Spanish.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Login en español, cotización de créditos antes de generar, Nueva marca con URL, Ofertas creadas al analizar la web, errores de imagen en español, y el modal de bienvenida cierra al primer clic.',
          en: 'Spanish login, credit quote before generate, New brand with URL, Offers created on site analysis, Spanish image errors, and welcome modal dismisses on first click.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'Chat nuevo disponible para todos: un chat para guiones, posts y fotos. Podés seguir en el panel clásico o elegir Chat como inicio cuando quieras.',
          en: 'New Chat is available for everyone: one chat for scripts, posts, and photos. Stay on classic or make Chat your home whenever you want.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'Al abrir el Chat por primera vez te regalamos 100 Créditos IA (válidos 12 meses) y un recorrido corto en español. Feedback bienvenido.',
          en: 'The first time you open Chat we gift 100 AI credits (valid 12 months) and a short tour. Feedback welcome.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'El chat responde saludos y te avisa si falta una oferta antes de generar. Venta directa más natural. Modo claro con inputs corregidos.',
          en: 'Chat answers greetings and tells you if an offer is missing before generating. More natural direct-sale scripts. Light mode input fixes.',
        },
      },
    ],
  },
  {
    version: '0.1.9',
    date: '2026-08-23',
    items: [
      {
        category: 'feature',
        text: {
          es: 'Créditos IA: un solo saldo para guiones e imágenes. Un guion cuesta 3, una imagen estándar 6, Pro 24. Compra un paquete o sube de plan cuando se te acaben.',
          en: 'AI credits: one balance for scripts and images. A script costs 3, a standard image 6, Pro 24. Buy a pack or upgrade when you run out.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Planes Starter ($33), Premium ($49) y Business ($149) con cupos de créditos claros. El checkout de Business y el paquete de 500 créditos se activan cuando pegamos el link de TiloPay.',
          en: 'Starter ($33), Premium ($49), and Business ($149) plans with clear credit allotments. Business checkout and the 500-credit pack go live once we paste the TiloPay links.',
        },
      },
    ],
  },
  {
    version: '0.1.8',
    date: '2026-08-19',
    items: [
      {
        category: 'improvement',
        text: {
          es: 'El Brand Kit y el botón para ocultarlo viven a la izquierda del campo de texto. Ya no tapan la conversación, y ocultar es un ícono limpio en vez de “× Ocultar”.',
          en: 'The Brand Kit and its hide control sit on the left of the text field. They no longer cover the conversation, and hide is a clean icon instead of “× Hide”.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Cambiar de carpeta de marca en la barra izquierda ya no hace saltar la lista.',
          en: 'Switching brand folders in the left bar no longer makes the list jump.',
        },
      },
    ],
  },
  {
    version: '0.1.7',
    date: '2026-08-14',
    items: [
      {
        category: 'feature',
        text: {
          es: 'Si te invitan a probar el chat nuevo, podés usarlo y volver al panel clásico cuando quieras. El resto de la app no cambia.',
          en: 'If you are invited to try the new chat, you can use it and return to the classic dashboard whenever you want. Everyone else stays on the current app.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Cambiar de carpeta de marca ya no vacía el chat a medias. El hilo actual se queda hasta que la otra marca está lista, y el panel de contexto ya no empuja toda la pantalla.',
          en: 'Switching brand folders no longer empties the chat halfway. The current thread stays until the other brand is ready, and the context panel no longer shoves the whole screen.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'La app ya no se recarga al volver de otra pestaña o al cambiar de ventana.',
          en: 'The app no longer reloads when you come back from another tab or window.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Al borrar una carpeta de marca también se borran sus chats y ofertas. Ya no quedan productos sueltos en Ofertas.',
          en: 'Deleting a brand folder now also deletes its chats and offers. Unassigned leftovers no longer pile up in Offers.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Si Ofertas dice que hay una oferta, ahora también la ves en el panel. El tema claro/oscuro está en Configuración → General.',
          en: 'If Offers says there is one offer, it now also shows in the panel. Light/dark theme lives in Settings → General.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Crear post ahora te pide elegir el guion, después revisar el texto, y recién ahí el tipo de post.',
          en: 'Create post now asks you to pick the script, then review the copy, and only then choose the post type.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'El listado de la derecha flota sobre el mismo fondo del chat, sin caja ni “En este chat”. Tocá una opción y se abre esa sección.',
          en: 'The right-hand list floats on the same chat background, with no box and no “in this chat” header. Tap an option to open that section.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'El chat se desplaza sin barras de scroll a la vista, el logo se ve bien en claro y oscuro, y el cambio de tema ya no está en la barra de arriba ni en Configuración → General.',
          en: 'Chat scrolls without visible scrollbars, the logo reads on light and dark, and theme switching is no longer in the top bar or Settings → General.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'Podés asignar a una marca los productos que todavía no tenían carpeta, y abrir el historial clásico de ese producto.',
          en: 'You can assign products that still have no folder to a brand, and open that product’s classic history.',
        },
      },
    ],
  },
  {
    version: '0.1.6',
    date: '2026-08-14',
    items: [
      {
        category: 'fix',
        text: {
          es: 'El saludo de bienvenida solo aparece en un chat nuevo. Recargar o reiniciar el servidor ya no lo vuelve a mandar en un hilo que ya tenía mensajes.',
          en: 'The welcome greeting only appears on a new chat. Reloading or restarting the server no longer resends it in a thread that already has messages.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Crear post y foto de producto ya no dejan el menú de guiones pegado. El post usa la versión editada del guion y mientras se edita ves para qué se está generando.',
          en: 'Create post and product photo no longer leave the script menu stuck. The post uses the edited script version, and while it generates you can see what is being edited.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Mientras piensa, el chat describe lo que está haciendo de verdad: leer el sitio, escribir venta directa, o generar el post. Subir el logo a mano sigue siendo la forma de asegurar calidad en los posts.',
          en: 'While thinking, chat describes what it is actually doing: reading the site, writing a direct-sale script, or generating the post. Uploading the logo yourself is still the way to keep post quality high.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Un post nuevo en el mismo chat ya no copia la primera imagen. Solo las ediciones y mejoras de esa imagen la usan de referencia.',
          en: 'A new post in the same chat no longer copies the first image. Only edits and enhancements of that image use it as a reference.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Guardar el kit de marca ya no rompe el chat con “Failed to update session” cuando el kit anterior no existía en la base.',
          en: 'Saving the brand kit no longer breaks chat with “Failed to update session” when the previous kit id was missing from the database.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'En el menú, Nueva marca queda arriba de las carpetas y la lista de marcas llena el espacio hasta tu perfil.',
          en: 'In the menu, New brand sits above the folders and the brand list fills the space down to your profile.',
        },
      },
    ],
  },
  {
    version: '0.1.5',
    date: '2026-08-14',
    items: [
      {
        category: 'improvement',
        text: {
          es: 'El chat vuelve a sentirse negro y azul: superficies en capas, bordes finos, y un azul apagado con un toque violeta. El logo Advance es más grande y centrado. Generar post tiene un degradé suave en movimiento.',
          en: 'Chat feels black and blue again: layered surfaces, hairline borders, and a muted navy with a hint of violet. The Advance mark is larger and centered. Generating a post has a slow moving gradient.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Los posts usan los colores y el logo del Brand Kit. El guion se compacta (gancho, prueba, CTA) para no llenar el post de texto. Subir logo (incluido SVG) ya no se traga el error.',
          en: 'Posts use Brand Kit colors and logo. The script is tightened (hook, proof, CTA) so the post is not overloaded with text. Uploading a logo (including SVG) no longer fails silently.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'La tarjeta de guion es más compacta: Copiar, Guardar, Editar y Crear post quedan a mano; Mejorar, Hooks y el resto van en Más.',
          en: 'The script card is more compact: Copy, Save, Edit, and Create post stay in reach; Improve, Hooks, and the rest live under More.',
        },
      },
    ],
  },
  {
    version: '0.1.4',
    date: '2026-08-13',
    items: [
      {
        category: 'fix',
        text: {
          es: 'Crear guiones ya no se corta con el error “chatModel is not defined”. Después de editar un guion podés volver a versiones anteriores, igual que con las imágenes.',
          en: 'Create scripts no longer dies with “chatModel is not defined”. After editing a script you can go back to earlier versions, same as images.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Si no se puede guardar la paleta todavía, el chat igual termina de leer el sitio y muestra el resumen. Ya no aparece “Setup failed” por eso.',
          en: 'If the palette can’t be saved yet, chat still finishes reading the site and shows the summary. You no longer get “Setup failed” from that.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'Pegá la URL y extraemos negocio y paleta juntos. Ajustá los colores en el chat y guardalos. Podés subir logo o referencias para los posts.',
          en: 'Paste the URL and we extract business and palette together. Tune the colors in chat and save them. You can upload a logo or references for posts.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Borrar carpeta es un basurero chico: X para cancelar, basurero otra vez para confirmar. Ahora sí se elimina.',
          en: 'Deleting a folder is a small trash icon: X to cancel, trash again to confirm. It actually deletes now.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'El setup fijado se queda arriba del chat al scrollear. Desaparece cuando está completo.',
          en: 'The pinned setup bar stays at the top of chat while you scroll. It hides when setup is complete.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'Podés borrar una carpeta de marca desde el menú, igual que un chat.',
          en: 'You can delete a brand folder from the menu, the same way you delete a chat.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Las imágenes del chat quedan al costado, del tamaño del post, sin el recuadro negro ancho. Clic para verlas grandes; pedir edición abre un chat nuevo.',
          en: 'Chat images sit to the side at the post’s own size, without the wide black frame. Click to view large; requesting an edit opens a new chat.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'El panel de Imágenes es para ver y pedir cambios. Generar posts sigue en Crear o en el chat.',
          en: 'The Images panel is for viewing and requesting changes. Generating posts stays in Create or chat.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'El progreso del negocio queda fijado arriba del chat. Tocá un paso para completarlo; cuando esté todo, la barra desaparece.',
          en: 'Business setup stays pinned at the top of chat. Tap a step to complete it; when everything is done, the bar disappears.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Si creás un post desde un guión, primero se compacta el texto para que la imagen no quede llena de copy.',
          en: 'If you create a post from a script, the copy is tightened first so the image isn’t packed with text.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Al confirmar el setup, la oferta queda lista para generar. Si hay una sola, se usa sola; si hay varias, el chat pregunta cuál. Ya no hace falta elegirla en el panel.',
          en: 'After you confirm setup, the offer is ready to generate. If there’s only one, it’s used automatically; if there are several, chat asks which. You don’t have to pick it in the panel.',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'Al pegar la URL o un texto de tu negocio, el chat arma un resumen para confirmar. Ya no te pregunta de a una cosa lo que ya estaba en el contexto.',
          en: 'When you paste a URL or a block of business text, chat drafts a summary to confirm. It no longer asks one-by-one for facts already in that context.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'Mientras lee un sitio, escribe un guion o genera una imagen, el chat muestra pasos de progreso para que sepas que está trabajando.',
          en: 'While it reads a site, writes a script, or generates an image, chat shows progress steps so you can tell it is working.',
        },
      },
      {
        category: 'improvement',
        text: {
          es: 'El chat cambió de sistema visual: tipografía más grande, menos azul eléctrico, y el panel derecho sirve para editar contexto — el setup sigue en la conversación.',
          en: 'Chat switched visual systems: larger type, less electric blue, and the right panel is for editing context — setup still happens in the conversation.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'Al crear una marca nueva, el chat te guía con una lista visual (negocio, canales, oferta, marca). Podés saltarla y completar después.',
          en: 'When you create a new brand, chat walks you through a visual checklist (business, channels, offer, brand). You can skip and finish later.',
        },
      },
      {
        category: 'feature',
        text: {
          es: 'El engranaje abre Configuración en una ventana: plan, uso, facturación, idioma y Brand Kits, sin salir del chat.',
          en: 'The gear opens Settings in a window: plan, usage, billing, language, and Brand Kits, without leaving chat.',
        },
      },
    ],
  },
  {
    version: '0.1.3',
    date: '2026-03-06',
    items: [
      {
        category: 'fix',
        text: {
          es: 'La app ya no se recarga al cambiar de pestaña o volver de otra aplicación — tu trabajo se mantiene intacto',
          en: 'The app no longer reloads when switching tabs or returning from another application — your work stays intact'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Navegación más fluida — menos tiempos de carga innecesarios al moverte entre secciones',
          en: 'Smoother navigation — fewer unnecessary loading times when moving between sections'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Optimización para móvil — la app ahora funciona correctamente desde el teléfono',
          en: 'Mobile optimization — the app now works properly on phone'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Guión optimizado ahora es editable — ajusta el prompt generado por "Optimizar para post" antes de generar',
          en: 'Optimized script is now editable — tweak the prompt generated by "Optimize for post" before generating'
        }
      }
    ]
  },
  {
    version: '0.1.2',
    date: '2026-02-27',
    items: [
      {
        category: 'feature',
        text: {
          es: 'Foto de Producto — nuevo tipo de post para fotografía profesional de producto con IA',
          en: 'Product Photo — new post type for AI-powered professional product photography'
        }
      },
      {
        category: 'feature',
        text: {
          es: '6 estilos de foto: Estudio Hero, Lifestyle, Cambiar Fondo, Solo Mejorar, Splash/Acción y Podio 3D',
          en: '6 photo styles: Studio Hero, Lifestyle, Background Swap, Pure Enhancement, Splash/Action and 3D Podium'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Formato cuadrado (1:1) disponible en modo Producto — ideal para e-commerce y catálogos',
          en: 'Square format (1:1) available in Product mode — ideal for e-commerce and catalogs'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Descripción de cliente ideal — pega un texto detallado de tu ICP en tu negocio para que la IA lo use en todo el contenido',
          en: 'Ideal customer description — paste a detailed ICP text in your business so the AI uses it across all content'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Brand Kit — define colores, voz y frases de tu marca en Configuración',
          en: 'Brand Kit — define brand colors, voice and phrases in Settings'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Sección "Desde el Desarrollador" — changelog, roadmap y feedback',
          en: '"From the Developer" section — changelog, roadmap and feedback'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Instrucciones adicionales al generar posts — guía el estilo y diseño con texto libre',
          en: 'Additional instructions when generating posts — guide style and design with free text'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Los ratings de guiones ahora se guardan y persisten entre sesiones',
          en: 'Script ratings now persist across sessions'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Ratings positivos ahora también mejoran la memoria de IA',
          en: 'Positive ratings now also improve AI memory'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Ahora puedes ver el uso de respuestas en tu resumen del plan',
          en: 'Reply usage now visible in your plan summary'
        }
      },
      {
        category: 'fix',
        text: {
          es: 'Corrección de formato cuadrado en prompts de fotografía de producto',
          en: 'Fixed square format label in product photography prompts'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Mejoras generales de estabilidad y rendimiento',
          en: 'General stability and performance improvements'
        }
      }
    ]
  },
  {
    version: '0.1.1',
    date: '2026-02-23',
    items: [
      {
        category: 'feature',
        text: {
          es: 'Estilos de post personalizados — sube referencias y crea tu propio estilo',
          en: 'Custom post styles — upload references and create your own style'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Respuestas a clientes (Respuestas) — genera respuestas de venta con IA',
          en: 'Client replies (Respuestas) — generate AI-powered sales replies'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Varita mágica — mejora posts generados con un click',
          en: 'Magic wand — enhance generated posts with one click'
        }
      }
    ]
  },
  {
    version: '0.1.0',
    date: '2026-02-16',
    items: [
      {
        category: 'feature',
        text: {
          es: '8 presets de estilo para posts (Features, Showcase, Social Proof, etc.)',
          en: '8 post style presets (Features, Showcase, Social Proof, etc.)'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Paletas de colores predefinidas y personalizadas para posts',
          en: 'Predefined and custom color palettes for posts'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Edición de imágenes con IA — modifica posts generados con instrucciones',
          en: 'AI image editing — modify generated posts with instructions'
        }
      }
    ]
  }
]
