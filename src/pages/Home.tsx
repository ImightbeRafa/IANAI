import { Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  Check, 
  ArrowRight,
  TrendingDown,
  UserCheck,
  BarChart3,
  FileText,
  PenTool,
  Mic,
  Image,
  Layers
} from 'lucide-react'

export default function Home() {
  const { language } = useLanguage()

  const t = {
    es: {
      nav: {
        features: 'Funcionalidades',
        pricing: 'Precios',
        login: 'Iniciar Sesión',
        signup: 'Empezá hoy'
      },
      hero: {
        title: 'Tu nueva herramienta para crear',
        titleHighlight: 'anuncios ganadores',
        subtitle: 'Genera guiones de venta y posts profesionales con IA. Entrenado con +1K anuncios de alto rendimiento.',
        cta: 'Empezá hoy'
      },
      benefits: {
        title: 'Beneficios principales',
        list: [
          'Bajá tus costos publicitarios',
          'Atraé leads con intención real de compra',
          'Lográ resultados sostenidos: campañas que venden por meses, no por días'
        ]
      },
      howItWorks: {
        title: 'Cómo funciona',
        step1: { num: '01', title: 'Tu negocio', desc: 'Describí tu producto, servicio y audiencia objetivo' },
        step2: { num: '02', title: 'IA genera', desc: 'Guiones ganadores + posts profesionales al instante' },
        step3: { num: '03', title: 'Publicá', desc: 'Contenido listo para grabar, diseñar y publicar' }
      },
      socialProof: {
        title: 'Creado con Advance AI',
        metaAds: 'Meta Ads – Resultados',
        chatMessages: 'Mensajes de chat reales'
      },
      flow: {
        title: 'El flujo que genera ventas',
        steps: ['Meta Ads', 'Mensaje de cliente', 'Contenido', 'Ventas']
      },
      reinforcement: 'Hacemos que vender por redes sociales sea más fácil',
      pricing: {
        badge: 'Precios',
        title: 'Planes simples, resultados reales',
        subtitle: 'Elegí el plan que mejor se adapte a tu negocio.',
        monthly: '/mes',
        free: {
          name: 'Free',
          price: '$0',
          features: [
            '10 guiones al mes',
            '10 descripciones al mes',
            '1 diseño gráfico de regalo al mes'
          ],
          cta: 'Empezá gratis'
        },
        starter: {
          name: 'Starter',
          price: '$33',
          features: [
            '30 guiones al mes',
            'Descripciones ilimitadas',
            '5 diseños publicitarios de regalo al mes'
          ],
          cta: 'Comenzar'
        },
        premium: {
          name: 'Premium',
          badge: 'Más popular',
          price: '$49',
          features: [
            'Guiones ilimitados',
            'Descripciones ilimitadas',
            'Entrada de voz para guiones',
            '100 diseños publicitarios al mes'
          ],
          cta: 'Comenzar'
        },
        enterprise: {
          name: 'Enterprise',
          price: '$299',
          features: [
            'Todo ilimitado',
            'Personalización del comportamiento de la IA',
            'Soporte prioritario'
          ],
          cta: 'Contactanos'
        }
      },
      features: {
        badge: 'Funcionalidades',
        title: 'Todo lo que necesitás para vender más',
        list: [
          'Genera guiones ganadores de venta',
          'Crea descripciones optimizadas para Ads',
          'Crea diferentes perfiles de consumidor',
          'Genera posts de venta directa con IA',
          'Genera posts de contenido orgánico con IA',
        ]
      },
      scripts: {
        badge: 'Guiones con IA',
        title: 'Guiones ganadores listos para grabar',
        subtitle: 'Entrenado con +1K anuncios ganadores. Solo danos el contexto de tu negocio y te entregamos guiones con estructura probada que vende.',
        bullets: [
          'Estructura Gancho → Desarrollo → CTA',
          'Entrenado con anuncios de alto rendimiento',
          'Personalizado para tu producto y audiencia',
          'Descripciones optimizadas para Ads incluidas'
        ]
      },
      posts: {
        badge: 'Posts con IA',
        title: '9 estilos de post profesional',
        subtitle: 'Desde venta directa hasta testimonios y comparaciones. Generá posts de nivel agencia en segundos.',
        bullets: [
          'Venta directa + 8 presets de diseño profesional',
          'Imágenes generadas por IA de alta calidad',
          'Formatos: Reel / Story y Feed',
          'Cada preset con prompt maestro optimizado'
        ]
      },
      presets: {
        title: 'Estilos de post disponibles',
        subtitle: 'Cada preset tiene un prompt maestro entrenado para generar diseños profesionales.'
      },
      cta: {
        title: 'Empezá a crear anuncios que venden',
        subtitle: 'Unite a negocios que ya generan guiones de alto impacto con IA.',
        button: 'Empezá hoy',
        note: 'No requiere tarjeta de crédito'
      },
      footer: {
        tagline: 'Anuncios ganadores potenciados por IA',
        rights: `© ${new Date().getFullYear()} Advance AI. Todos los derechos reservados.`
      }
    },
    en: {
      nav: {
        features: 'Features',
        pricing: 'Pricing',
        login: 'Log In',
        signup: 'Get Started'
      },
      hero: {
        title: 'Your new tool to create',
        titleHighlight: 'winning ads',
        subtitle: 'Generate sales scripts and professional posts with AI. Trained with +1K high-performance ads.',
        cta: 'Get Started'
      },
      benefits: {
        title: 'Key Benefits',
        list: [
          'Lower your ad costs',
          'Attract leads with real buying intent',
          'Achieve sustained results: campaigns that sell for months, not days'
        ]
      },
      howItWorks: {
        title: 'How it works',
        step1: { num: '01', title: 'Your business', desc: 'Describe your product, service and target audience' },
        step2: { num: '02', title: 'AI generates', desc: 'Winning scripts + professional posts instantly' },
        step3: { num: '03', title: 'Publish', desc: 'Content ready to record, design and publish' }
      },
      socialProof: {
        title: 'Created with Advance AI',
        metaAds: 'Meta Ads – Results',
        chatMessages: 'Real chat messages'
      },
      flow: {
        title: 'The flow that drives sales',
        steps: ['Meta Ads', 'Client message', 'Content', 'Sales']
      },
      reinforcement: 'We make selling on social media easier',
      pricing: {
        badge: 'Pricing',
        title: 'Simple plans, real results',
        subtitle: 'Choose the plan that best fits your business.',
        monthly: '/mo',
        free: {
          name: 'Free',
          price: '$0',
          features: [
            '10 scripts per month',
            '10 descriptions per month',
            '1 free graphic design per month'
          ],
          cta: 'Start for free'
        },
        starter: {
          name: 'Starter',
          price: '$33',
          features: [
            '30 scripts per month',
            'Unlimited descriptions',
            '5 free ad designs per month'
          ],
          cta: 'Get Started'
        },
        premium: {
          name: 'Premium',
          badge: 'Most popular',
          price: '$49',
          features: [
            'Unlimited scripts',
            'Unlimited descriptions',
            'Voice input for scripts',
            '100 ad designs per month'
          ],
          cta: 'Get Started'
        },
        enterprise: {
          name: 'Enterprise',
          price: '$299',
          features: [
            'Everything unlimited',
            'AI behavior customization',
            'Priority support'
          ],
          cta: 'Contact us'
        }
      },
      features: {
        badge: 'Features',
        title: 'Everything you need to sell more',
        list: [
          'Generate winning sales scripts',
          'Create optimized descriptions for Ads',
          'Create different consumer profiles',
          'Generate direct sale posts with AI',
          'Generate organic content posts with AI',
        ]
      },
      scripts: {
        badge: 'AI Scripts',
        title: 'Winning scripts ready to record',
        subtitle: 'Trained with +1K winning ads. Just give us your business context and we deliver scripts with a proven structure that sells.',
        bullets: [
          'Proven structure: Hook → Development → CTA',
          'Trained with high-performance ads',
          'Personalized for your product and audience',
          'Optimized ad descriptions included'
        ]
      },
      posts: {
        badge: 'AI Posts',
        title: '9 professional post styles',
        subtitle: 'From direct sale to testimonials and comparisons. Generate agency-level posts in seconds.',
        bullets: [
          'Direct sale + 8 professional design presets',
          'High quality AI-generated images',
          'Formats: Reel / Story and Feed',
          'Each preset with optimized master prompt'
        ]
      },
      presets: {
        title: 'Available post styles',
        subtitle: 'Each preset has a trained master prompt to generate professional designs.'
      },
      cta: {
        title: 'Start creating ads that sell',
        subtitle: 'Join businesses already generating high-impact scripts with AI.',
        button: 'Get Started',
        note: 'No credit card required'
      },
      footer: {
        tagline: 'AI-powered winning ads',
        rights: `© ${new Date().getFullYear()} Advance AI. All rights reserved.`
      }
    }
  }

  const labels = t[language]

  const floatingPosts = [
    // Left side
    { img: '/presets/01_Features_Benefits/020_Access_183.png', label: 'Features', pos: 'left-[1%] top-[10%]', anim: 'animate-float-up', delay: '' },
    { img: '/presets/03_Social_Proof/007_Access_93.png', label: 'Social Proof', pos: 'left-[4%] top-[50%]', anim: 'animate-float-down', delay: 'animation-delay-2' },
    { img: '/presets/06_Collage/009_Access_255-256.png', label: 'Collage', pos: 'left-[14%] top-[28%]', anim: 'animate-float-down', delay: 'animation-delay-4' },
    { img: '/presets/02_Product_Showcase/036_Access_204.png', label: 'Showcase', pos: 'left-[10%] top-[68%]', anim: 'animate-float-slow', delay: 'animation-delay-1' },
    { img: '/presets/04_Comparison/021_Access_312-313.png', label: 'Comparison', pos: 'left-[22%] top-[8%]', anim: 'animate-float-up', delay: 'animation-delay-3' },
    // Right side
    { img: '/presets/07_Deals_Discounts/014_Access_136.png', label: 'Deals', pos: 'right-[1%] top-[12%]', anim: 'animate-float-slow', delay: 'animation-delay-1' },
    { img: '/presets/08_Testimonial/013_Access_147.png', label: 'Testimonial', pos: 'right-[4%] top-[52%]', anim: 'animate-float-up', delay: 'animation-delay-3' },
    { img: '/presets/05_Before_After/005_Access_99.png', label: 'Before/After', pos: 'right-[14%] top-[32%]', anim: 'animate-float-slow', delay: 'animation-delay-2' },
    { img: '/presets/02_Product_Showcase/018_Access_132.png', label: 'Product', pos: 'right-[10%] top-[70%]', anim: 'animate-float-down', delay: 'animation-delay-4' },
    { img: '/presets/04_Comparison/014_Access_71.png', label: 'Compare', pos: 'right-[22%] top-[6%]', anim: 'animate-float-down', delay: '' },
    // Extra inner ring
    { img: '/presets/02_Product_Showcase/053_Access_310-311.png', label: 'Product', pos: 'left-[26%] top-[55%]', anim: 'animate-float-up', delay: 'animation-delay-2' },
    { img: '/presets/07_Deals_Discounts/014_Access_136.png', label: 'Deals', pos: 'right-[26%] top-[60%]', anim: 'animate-float-slow', delay: 'animation-delay-1' },
  ]

  return (
    <div className="min-h-screen bg-dark-100 overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-dark-100/80 backdrop-blur-lg border-b border-dark-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Advance AI" className="w-10 h-10 object-contain rounded-xl" />
              <span className="text-xl font-extrabold" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-dark-600 hover:text-primary-600 transition-colors text-sm font-medium">
                {labels.nav.features}
              </a>
              <a href="#pricing" className="text-dark-600 hover:text-primary-600 transition-colors text-sm font-medium">
                {labels.nav.pricing}
              </a>
              <Link to="/login" className="text-dark-600 hover:text-primary-600 transition-colors text-sm font-medium">
                {labels.nav.login}
              </Link>
              <Link 
                to="/signup" 
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-all text-sm shadow-sm shadow-primary-500/20"
              >
                {labels.nav.signup}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section with Floating Reels */}
      <section className="relative pt-20 pb-14 sm:pt-28 sm:pb-24 px-4 sm:px-6 lg:px-8 bg-dark-100 overflow-hidden min-h-[70vh] sm:min-h-[90vh] flex items-center">
        {/* Ambient glow */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl animate-pulse-soft" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl animate-pulse-soft animation-delay-2" />
        </div>

        {/* Floating Post Thumbnails — hidden on mobile */}
        <div className="hidden lg:block absolute inset-0 pointer-events-none">
          {floatingPosts.map((post, i) => (
            <div
              key={i}
              className={`absolute ${post.pos} ${post.anim} ${post.delay}`}
              style={{ opacity: 0.35 }}
            >
              <div className="w-[110px] rounded-2xl overflow-hidden shadow-2xl border border-dark-100 bg-dark-100">
                <img src={post.img} alt={post.label} className="w-full h-[140px] object-cover" />
                <div className="px-2 py-1.5 text-center">
                  <span className="text-[9px] text-dark-500 font-semibold">{post.label}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Hero Content */}
        <div className="max-w-7xl mx-auto relative z-10 w-full">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-3xl sm:text-5xl lg:text-7xl font-bold text-dark-900 mb-4 sm:mb-6 leading-[1.1] tracking-tight animate-fade-in-up">
              {labels.hero.title}{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-sky-500">
                {labels.hero.titleHighlight}
              </span>
            </h1>

            <p className="text-base sm:text-xl text-dark-500 mb-6 sm:mb-10 max-w-xl mx-auto leading-relaxed animate-fade-in-up animation-delay-1">
              {labels.hero.subtitle}
            </p>

            <div className="flex justify-center animate-fade-in-up animation-delay-2">
              <Link 
                to="/signup" 
                className="px-8 py-3 sm:px-10 sm:py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-semibold text-base sm:text-lg transition-all shadow-lg shadow-primary-500/25 flex items-center gap-3 group"
              >
                {labels.hero.cta}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-12 sm:py-24 px-4 sm:px-6 lg:px-8 bg-dark-100">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-4xl font-bold text-dark-900 text-center mb-8 sm:mb-14">
            {labels.benefits.title}
          </h2>
          <div className="grid gap-5">
            {labels.benefits.list.map((benefit, i) => {
              const icons = [
                <TrendingDown className="w-6 h-6 text-primary-600" />,
                <UserCheck className="w-6 h-6 text-primary-600" />,
                <BarChart3 className="w-6 h-6 text-primary-600" />
              ]
              return (
                <div key={i} className="flex items-start gap-5 bg-dark-50/50 border border-dark-100 rounded-2xl p-6 hover:border-primary-200 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
                  <div className="w-12 h-12 bg-primary-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                    {icons[i]}
                  </div>
                  <p className="text-lg text-dark-700 font-medium pt-2">{benefit}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Guiones Showcase */}
      <section className="py-12 sm:py-24 px-4 sm:px-6 lg:px-8 bg-dark-100">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            {/* Left — Script Mockup */}
            <div className="relative">
              <div className="bg-dark-50 rounded-2xl p-6 shadow-2xl border border-dark-200">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                  <span className="text-dark-400 text-xs ml-2">Advance AI — Script Generator</span>
                </div>
                <div className="space-y-3">
                  <div className="bg-primary-500/10 border border-primary-500/20 rounded-xl px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-primary-400 font-semibold mb-1">GANCHO</div>
                    <p className="text-sm text-dark-700">{language === 'es' ? '¿Sabías que el 80% de los anuncios fallan en los primeros 3 segundos?' : 'Did you know 80% of ads fail in the first 3 seconds?'}</p>
                  </div>
                  <div className="bg-dark-100 rounded-xl px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1">{language === 'es' ? 'DESARROLLO' : 'DEVELOPMENT'}</div>
                    <p className="text-sm text-dark-600">{language === 'es' ? 'Nuestro método usa la estructura de los anuncios más exitosos del mercado para que tu mensaje conecte al instante...' : 'Our method uses the structure of the most successful ads on the market so your message connects instantly...'}</p>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">CTA</div>
                    <p className="text-sm text-dark-700">{language === 'es' ? 'Empezá hoy — los primeros 10 guiones son gratis.' : 'Start today — the first 10 scripts are free.'}</p>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-primary-500/10 rounded-full blur-2xl" />
            </div>

            {/* Right — Text */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-900/30 border border-primary-200 rounded-full mb-6">
                <FileText className="w-4 h-4 text-primary-600" />
                <span className="text-sm text-primary-700 font-medium">{labels.scripts.badge}</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4 leading-tight">
                {labels.scripts.title}
              </h2>
              <p className="text-lg text-dark-500 mb-8 leading-relaxed">
                {labels.scripts.subtitle}
              </p>
              <ul className="space-y-3">
                {labels.scripts.bullets.map((b: string, i: number) => (
                  <li key={i} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600 font-medium">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Posts Showcase */}
      <section className="py-12 sm:py-24 px-4 sm:px-6 lg:px-8 bg-dark-100">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            {/* Left — Text */}
            <div className="order-2 lg:order-1">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-900/30 border border-primary-200 rounded-full mb-6">
                <Image className="w-4 h-4 text-primary-600" />
                <span className="text-sm text-primary-700 font-medium">{labels.posts.badge}</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4 leading-tight">
                {labels.posts.title}
              </h2>
              <p className="text-lg text-dark-500 mb-8 leading-relaxed">
                {labels.posts.subtitle}
              </p>
              <ul className="space-y-3">
                {labels.posts.bullets.map((b: string, i: number) => (
                  <li key={i} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600 font-medium">{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right — Post Thumbnails Grid */}
            <div className="order-1 lg:order-2">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { img: '/presets/01_Features_Benefits/020_Access_183.png', name: language === 'es' ? 'Características' : 'Features' },
                  { img: '/presets/07_Deals_Discounts/014_Access_136.png', name: language === 'es' ? 'Ofertas' : 'Deals' },
                  { img: '/presets/04_Comparison/014_Access_71.png', name: language === 'es' ? 'Comparación' : 'Comparison' },
                  { img: '/presets/08_Testimonial/013_Access_147.png', name: language === 'es' ? 'Testimonio' : 'Testimonial' },
                ].map((item, i) => (
                  <div key={i} className="relative group overflow-hidden rounded-2xl shadow-lg border border-dark-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                    <img src={item.img} alt={item.name} className="w-full aspect-[3/4] object-cover" />
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                      <span className="text-white text-xs font-semibold">{item.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Presets Gallery */}
      <section id="features" className="py-12 sm:py-24 px-4 sm:px-6 lg:px-8 bg-dark-100 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8 sm:mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-900/30 border border-primary-200 rounded-full mb-4">
              <Layers className="w-4 h-4 text-primary-600" />
              <span className="text-sm text-primary-700 font-medium">{labels.features.badge}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-3">
              {labels.presets.title}
            </h2>
            <p className="text-lg text-dark-500 max-w-2xl mx-auto">
              {labels.presets.subtitle}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { img: '/presets/01_Features_Benefits/020_Access_183.png', name: language === 'es' ? 'Características y Beneficios' : 'Features & Benefits', count: 78 },
              { img: '/presets/02_Product_Showcase/018_Access_132.png', name: language === 'es' ? 'Exhibición de Producto' : 'Product Showcase', count: 70 },
              { img: '/presets/03_Social_Proof/007_Access_93.png', name: language === 'es' ? 'Prueba Social' : 'Social Proof', count: 27 },
              { img: '/presets/04_Comparison/014_Access_71.png', name: language === 'es' ? 'Comparación' : 'Comparison', count: 27 },
              { img: '/presets/05_Before_After/005_Access_99.png', name: language === 'es' ? 'Antes y Después' : 'Before & After', count: 18 },
              { img: '/presets/06_Collage/009_Access_255-256.png', name: language === 'es' ? 'Collage' : 'Collage', count: 34 },
              { img: '/presets/07_Deals_Discounts/014_Access_136.png', name: language === 'es' ? 'Ofertas y Descuentos' : 'Deals & Discounts', count: 53 },
              { img: '/presets/08_Testimonial/013_Access_147.png', name: language === 'es' ? 'Testimonio' : 'Testimonial', count: 49 },
            ].map((preset, i) => (
              <div key={i} className="group relative overflow-hidden rounded-2xl shadow-md border border-dark-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-default">
                <img src={preset.img} alt={preset.name} className="w-full aspect-[3/4] object-cover group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 inset-x-0 p-3">
                  <span className="text-white text-xs sm:text-sm font-bold block leading-tight">{preset.name}</span>
                  <span className="text-white/60 text-[10px] mt-0.5 block">{preset.count} {language === 'es' ? 'plantillas' : 'templates'}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Additional Features row */}
          <div className="grid sm:grid-cols-3 gap-3 sm:gap-4 mt-8 sm:mt-12">
            {[
              { icon: <PenTool className="w-5 h-5" />, text: language === 'es' ? 'Descripciones optimizadas para Ads' : 'Optimized ad descriptions' },
              { icon: <Mic className="w-5 h-5" />, text: language === 'es' ? 'Entrada de voz para guiones' : 'Voice input for scripts' },
              { icon: <Image className="w-5 h-5" />, text: language === 'es' ? 'Posts orgánicos y de venta directa' : 'Organic and direct-sale posts' },
            ].map((feat, i) => (
              <div key={i} className="flex items-center gap-3 bg-dark-50 border border-dark-100 rounded-xl p-4 hover:border-primary-200 transition-colors">
                <div className="w-10 h-10 bg-primary-900/30 rounded-xl flex items-center justify-center text-primary-600 flex-shrink-0">
                  {feat.icon}
                </div>
                <span className="text-sm text-dark-700 font-medium">{feat.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-12 sm:py-24 px-4 sm:px-6 lg:px-8 bg-dark-100">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8 sm:mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-900/30 border border-primary-200 rounded-full mb-4">
              <span className="text-sm text-primary-700 font-medium">{labels.pricing.badge}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4">
              {labels.pricing.title}
            </h2>
            <p className="text-lg text-dark-600 max-w-2xl mx-auto">
              {labels.pricing.subtitle}
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 max-w-6xl mx-auto">
            {/* Free Plan */}
            <div className="bg-dark-100 border border-dark-100 rounded-2xl p-4 sm:p-8 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <h3 className="text-base sm:text-xl font-semibold text-dark-900 mb-1 sm:mb-2">{labels.pricing.free.name}</h3>
              <div className="flex items-baseline gap-1 mb-4 sm:mb-6 mt-1 sm:mt-2">
                <span className="text-2xl sm:text-4xl font-bold text-dark-900">{labels.pricing.free.price}</span>
                <span className="text-dark-500 text-xs sm:text-base">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-2 sm:py-3 px-3 sm:px-4 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 mb-4 sm:mb-8 text-sm sm:text-base"
              >
                {labels.pricing.free.cta}
              </Link>
              <ul className="space-y-2 sm:space-y-3 flex-1">
                {labels.pricing.free.features.map((feature: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 sm:gap-3">
                    <Check className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600 text-xs sm:text-base">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Starter Plan */}
            <div className="bg-dark-100 border border-dark-100 rounded-2xl p-4 sm:p-8 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <h3 className="text-base sm:text-xl font-semibold text-dark-900 mb-1 sm:mb-2">{labels.pricing.starter.name}</h3>
              <div className="flex items-baseline gap-1 mb-4 sm:mb-6 mt-1 sm:mt-2">
                <span className="text-2xl sm:text-4xl font-bold text-dark-900">{labels.pricing.starter.price}</span>
                <span className="text-dark-500 text-xs sm:text-base">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-2 sm:py-3 px-3 sm:px-4 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 mb-4 sm:mb-8 text-sm sm:text-base"
              >
                {labels.pricing.starter.cta}
              </Link>
              <ul className="space-y-2 sm:space-y-3 flex-1">
                {labels.pricing.starter.features.map((feature: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 sm:gap-3">
                    <Check className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600 text-xs sm:text-base">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Premium Plan (highlighted) */}
            <div className="bg-dark-100 border-2 border-primary-500 rounded-2xl p-4 sm:p-8 relative shadow-lg shadow-primary-500/10 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="px-3 sm:px-4 py-1 bg-primary-600 rounded-full text-[10px] sm:text-sm font-medium text-white shadow-lg shadow-primary-500/30">
                  {labels.pricing.premium.badge}
                </div>
              </div>
              <h3 className="text-base sm:text-xl font-semibold text-dark-900 mb-1 sm:mb-2">{labels.pricing.premium.name}</h3>
              <div className="flex items-baseline gap-1 mb-4 sm:mb-6 mt-1 sm:mt-2">
                <span className="text-2xl sm:text-4xl font-bold text-dark-900">{labels.pricing.premium.price}</span>
                <span className="text-dark-500 text-xs sm:text-base">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-2 sm:py-3 px-3 sm:px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 mb-4 sm:mb-8 text-sm sm:text-base"
              >
                {labels.pricing.premium.cta}
              </Link>
              <ul className="space-y-2 sm:space-y-3 flex-1">
                {labels.pricing.premium.features.map((feature: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 sm:gap-3">
                    <Check className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600 text-xs sm:text-base">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-dark-100 border border-dark-100 rounded-2xl p-4 sm:p-8 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <h3 className="text-base sm:text-xl font-semibold text-dark-900 mb-1 sm:mb-2">{labels.pricing.enterprise.name}</h3>
              <div className="flex items-baseline gap-1 mb-4 sm:mb-6 mt-1 sm:mt-2">
                <span className="text-2xl sm:text-4xl font-bold text-dark-900">{labels.pricing.enterprise.price}</span>
                <span className="text-dark-500 text-xs sm:text-base">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-2 sm:py-3 px-3 sm:px-4 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 mb-4 sm:mb-8 text-sm sm:text-base"
              >
                {labels.pricing.enterprise.cta}
              </Link>
              <ul className="space-y-2 sm:space-y-3 flex-1">
                {labels.pricing.enterprise.features.map((feature: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 sm:gap-3">
                    <Check className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600 text-xs sm:text-base">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 sm:py-24 px-4 sm:px-6 lg:px-8 bg-dark-100">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-dark-50 border border-dark-200 rounded-3xl p-8 sm:p-14 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl" />
            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4">
                {labels.cta.title}
              </h2>
              <p className="text-base sm:text-lg text-dark-500 mb-6 sm:mb-10 max-w-2xl mx-auto">
                {labels.cta.subtitle}
              </p>
              <Link 
                to="/signup"
                className="inline-flex items-center gap-2 px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-semibold text-lg transition-all shadow-lg shadow-primary-500/25 group"
              >
                {labels.cta.button}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <p className="text-sm text-dark-400 mt-5">{labels.cta.note}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-dark-100 border-t border-dark-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Advance AI" className="w-8 h-8 object-contain rounded-lg" />
              <span className="font-extrabold" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
              <span className="text-dark-400 text-sm">• {labels.footer.tagline}</span>
            </div>
            <p className="text-dark-400 text-sm">{labels.footer.rights}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
