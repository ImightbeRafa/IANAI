import { Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  Zap, 
  Target, 
  Clock, 
  Check, 
  ArrowRight,
  Play,
  Star,
  MessageSquare,
  Layers,
  Globe,
  Sparkles
} from 'lucide-react'

export default function Home() {
  const { language } = useLanguage()

  const t = {
    es: {
      nav: {
        features: 'Características',
        pricing: 'Precios',
        login: 'Iniciar Sesión',
        signup: 'Comenzar Gratis'
      },
      hero: {
        badge: 'IA de última generación para ventas',
        title: 'Genera guiones de venta que',
        titleHighlight: 'realmente convierten',
        subtitle: 'Deja de adivinar qué decir. Nuestra IA entrenada con el Método Ian crea guiones de alto impacto para TikTok, Reels e historias que generan mensajes en tu DM.',
        cta: 'Empezar ahora',
        ctaSecondary: 'Ver demo',
        trusted: 'Usado por equipos de marketing en'
      },
      features: {
        badge: 'Características',
        title: 'Todo lo que necesitas para vender más',
        subtitle: 'Herramientas profesionales de copywriting potenciadas por IA',
        list: [
          {
            icon: 'Zap',
            title: '5 Estructuras Maestras',
            description: 'Venta Directa, Desvalidar Alternativas, Mostrar Servicio, Variedad de Productos y Paso a Paso. Cada una optimizada para diferentes objetivos.'
          },
          {
            icon: 'Target',
            title: 'Metodología Ian',
            description: 'Entrenada con el método probado de ingeniería de contenido. Cero saludos, máxima conversión, CTAs que funcionan.'
          },
          {
            icon: 'Clock',
            title: 'Duraciones Flexibles',
            description: 'Genera guiones de 15, 30, 60 o 90 segundos. Perfectos para cualquier plataforma y formato de contenido.'
          },
          {
            icon: 'MessageSquare',
            title: 'Chat Inteligente',
            description: 'Itera y mejora tus guiones con feedback en tiempo real. La IA aprende de tus preferencias.'
          },
          {
            icon: 'Layers',
            title: 'Multi-producto',
            description: 'Gestiona productos, servicios, restaurantes e inmobiliarias. Cada tipo con su propia optimización.'
          },
          {
            icon: 'Globe',
            title: 'Bilingüe',
            description: 'Genera contenido en español e inglés con la misma calidad y naturalidad.'
          }
        ]
      },
      pricing: {
        badge: 'Precios',
        title: 'Simple y transparente',
        subtitle: 'Sin sorpresas. Elige el plan que mejor se adapte a tu negocio.',
        monthly: '/mes',
        single: {
          name: 'Individual',
          price: '$30',
          description: 'Perfecto para creadores y emprendedores',
          features: [
            'Hasta 10 productos/servicios',
            '100 generaciones de guiones/mes',
            '5 estructuras maestras',
            'Todas las duraciones',
            'Chat con IA ilimitado',
            'Historial de conversaciones',
            'Exportar guiones'
          ],
          cta: 'Comenzar'
        },
        team: {
          name: 'Equipos',
          price: '$400',
          description: 'Para agencias y equipos de marketing',
          badge: 'Más popular',
          features: [
            'Hasta 5 miembros del equipo',
            'Productos ilimitados',
            'Generaciones ilimitadas',
            'Gestión de clientes',
            'Todas las características Individual',
            'Colaboración en tiempo real',
            'Soporte prioritario',
            'API access (próximamente)'
          ],
          cta: 'Contactar ventas'
        }
      },
      cta: {
        title: '¿Listo para multiplicar tus ventas?',
        subtitle: 'Únete a cientos de negocios que ya generan guiones de alto impacto con IA.',
        button: 'Crear cuenta gratis',
        note: 'No requiere tarjeta de crédito'
      },
      footer: {
        tagline: 'Guiones de venta potenciados por IA',
        rights: '© 2024 Advance AI. Todos los derechos reservados.'
      }
    },
    en: {
      nav: {
        features: 'Features',
        pricing: 'Pricing',
        login: 'Log In',
        signup: 'Get Started Free'
      },
      hero: {
        badge: 'State-of-the-art sales AI',
        title: 'Generate sales scripts that',
        titleHighlight: 'actually convert',
        subtitle: 'Stop guessing what to say. Our AI trained with the Ian Method creates high-impact scripts for TikTok, Reels and stories that drive DMs.',
        cta: 'Get started',
        ctaSecondary: 'Watch demo',
        trusted: 'Trusted by marketing teams at'
      },
      features: {
        badge: 'Features',
        title: 'Everything you need to sell more',
        subtitle: 'Professional copywriting tools powered by AI',
        list: [
          {
            icon: 'Zap',
            title: '5 Master Structures',
            description: 'Direct Sale, Invalidate Alternatives, Show Service, Product Variety and Step by Step. Each optimized for different goals.'
          },
          {
            icon: 'Target',
            title: 'Ian Methodology',
            description: 'Trained with proven content engineering method. Zero greetings, maximum conversion, CTAs that work.'
          },
          {
            icon: 'Clock',
            title: 'Flexible Durations',
            description: 'Generate 15, 30, 60 or 90 second scripts. Perfect for any platform and content format.'
          },
          {
            icon: 'MessageSquare',
            title: 'Smart Chat',
            description: 'Iterate and improve your scripts with real-time feedback. The AI learns from your preferences.'
          },
          {
            icon: 'Layers',
            title: 'Multi-product',
            description: 'Manage products, services, restaurants and real estate. Each type with its own optimization.'
          },
          {
            icon: 'Globe',
            title: 'Bilingual',
            description: 'Generate content in Spanish and English with the same quality and naturalness.'
          }
        ]
      },
      pricing: {
        badge: 'Pricing',
        title: 'Simple and transparent',
        subtitle: 'No surprises. Choose the plan that best fits your business.',
        monthly: '/month',
        single: {
          name: 'Individual',
          price: '$30',
          description: 'Perfect for creators and entrepreneurs',
          features: [
            'Up to 10 products/services',
            '100 script generations/month',
            '5 master structures',
            'All durations',
            'Unlimited AI chat',
            'Conversation history',
            'Export scripts'
          ],
          cta: 'Get started'
        },
        team: {
          name: 'Teams',
          price: '$400',
          description: 'For agencies and marketing teams',
          badge: 'Most popular',
          features: [
            'Up to 5 team members',
            'Unlimited products',
            'Unlimited generations',
            'Client management',
            'All Individual features',
            'Real-time collaboration',
            'Priority support',
            'API access (coming soon)'
          ],
          cta: 'Contact sales'
        }
      },
      cta: {
        title: 'Ready to multiply your sales?',
        subtitle: 'Join hundreds of businesses already generating high-impact scripts with AI.',
        button: 'Create free account',
        note: 'No credit card required'
      },
      footer: {
        tagline: 'AI-powered sales scripts',
        rights: '© 2024 Advance AI. All rights reserved.'
      }
    }
  }

  const labels = t[language]

  const FeatureIcon = ({ name }: { name: string }) => {
    const icons: Record<string, React.ReactNode> = {
      'Zap': <Zap className="w-6 h-6" />,
      'Target': <Target className="w-6 h-6" />,
      'Clock': <Clock className="w-6 h-6" />,
      'MessageSquare': <MessageSquare className="w-6 h-6" />,
      'Layers': <Layers className="w-6 h-6" />,
      'Globe': <Globe className="w-6 h-6" />
    }
    return <>{icons[name]}</>
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-dark-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Advance AI" className="w-10 h-10 object-contain rounded-xl" />
              <span className="text-xl font-bold italic" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-dark-600 hover:text-primary-600 transition-colors">
                {labels.nav.features}
              </a>
              <a href="#pricing" className="text-dark-600 hover:text-primary-600 transition-colors">
                {labels.nav.pricing}
              </a>
              <Link to="/login" className="text-dark-600 hover:text-primary-600 transition-colors">
                {labels.nav.login}
              </Link>
              <Link 
                to="/signup" 
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
              >
                {labels.nav.signup}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-primary-50 to-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-100 border border-primary-200 rounded-full mb-8">
              <Sparkles className="w-4 h-4 text-primary-600" />
              <span className="text-sm text-primary-700 font-medium">{labels.hero.badge}</span>
            </div>

            {/* Title */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-dark-900 mb-6 leading-tight">
              {labels.hero.title}{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-sky-500">
                {labels.hero.titleHighlight}
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-dark-600 mb-10 max-w-2xl mx-auto leading-relaxed">
              {labels.hero.subtitle}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
              <Link 
                to="/signup" 
                className="w-full sm:w-auto px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold text-lg transition-all shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 group"
              >
                {labels.hero.cta}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <button className="w-full sm:w-auto px-8 py-4 bg-white hover:bg-dark-50 text-dark-700 rounded-xl font-semibold text-lg transition-all border border-dark-200 flex items-center justify-center gap-2">
                <Play className="w-5 h-5" />
                {labels.hero.ctaSecondary}
              </button>
            </div>

            {/* Hero Visual */}
            <div className="relative">
              <div className="bg-white rounded-2xl p-4 shadow-2xl border border-dark-100">
                <div className="bg-dark-50 rounded-xl overflow-hidden">
                  {/* Mock UI */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-dark-100">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400" />
                      <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      <div className="w-3 h-3 rounded-full bg-green-400" />
                    </div>
                    <div className="flex-1 flex justify-center">
                      <div className="px-4 py-1 bg-dark-100 rounded-lg text-sm text-dark-500">
                        app.advanceai.com
                      </div>
                    </div>
                  </div>
                  <div className="p-6 space-y-4 bg-dark-50">
                    <div className="flex gap-4">
                      <div className="w-1/3 space-y-3">
                        <div className="h-8 bg-white rounded-lg border border-dark-100" />
                        <div className="h-24 bg-white rounded-lg border border-dark-100" />
                        <div className="h-24 bg-white rounded-lg border border-dark-100" />
                      </div>
                      <div className="flex-1 space-y-3">
                        <div className="flex gap-2">
                          <div className="h-8 w-24 bg-primary-100 rounded-lg" />
                          <div className="h-8 w-20 bg-dark-100 rounded-lg" />
                        </div>
                        <div className="bg-white rounded-xl p-4 border border-dark-100">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex-shrink-0" />
                            <div className="flex-1 space-y-2">
                              <div className="h-4 bg-dark-100 rounded w-3/4" />
                              <div className="h-4 bg-dark-100 rounded w-full" />
                              <div className="h-4 bg-dark-100 rounded w-5/6" />
                            </div>
                          </div>
                        </div>
                        <div className="bg-primary-50 rounded-xl p-4 border border-primary-200">
                          <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-primary-600" />
                            <span className="text-sm text-primary-700 font-medium">{language === 'es' ? 'Guión generado' : 'Generated script'}</span>
                          </div>
                          <div className="space-y-2">
                            <div className="h-3 bg-primary-200 rounded w-full" />
                            <div className="h-3 bg-primary-200 rounded w-5/6" />
                            <div className="h-3 bg-primary-200 rounded w-4/5" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-white border-y border-dark-100">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: '10K+', label: language === 'es' ? 'Guiones generados' : 'Scripts generated' },
              { value: '500+', label: language === 'es' ? 'Negocios activos' : 'Active businesses' },
              { value: '95%', label: language === 'es' ? 'Satisfacción' : 'Satisfaction rate' },
              { value: '24/7', label: language === 'es' ? 'IA disponible' : 'AI available' }
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-primary-600 mb-2">{stat.value}</div>
                <div className="text-dark-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-100 border border-primary-200 rounded-full mb-4">
              <span className="text-sm text-primary-700 font-medium">{labels.features.badge}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4">
              {labels.features.title}
            </h2>
            <p className="text-lg text-dark-600 max-w-2xl mx-auto">
              {labels.features.subtitle}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {labels.features.list.map((feature, i) => (
              <div 
                key={i}
                className="bg-white border border-dark-100 rounded-2xl p-6 hover:border-primary-300 hover:shadow-lg transition-all group"
              >
                <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mb-4 text-primary-600 group-hover:bg-primary-600 group-hover:text-white transition-all">
                  <FeatureIcon name={feature.icon} />
                </div>
                <h3 className="text-xl font-semibold text-dark-900 mb-2">{feature.title}</h3>
                <p className="text-dark-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4">
              {language === 'es' ? 'Cómo funciona' : 'How it works'}
            </h2>
            <p className="text-lg text-dark-600 max-w-2xl mx-auto">
              {language === 'es' 
                ? 'En 3 simples pasos, genera guiones de venta profesionales' 
                : 'In 3 simple steps, generate professional sales scripts'}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: language === 'es' ? 'Describe tu producto' : 'Describe your product',
                description: language === 'es' 
                  ? 'Completa un formulario simple con la información de tu producto o servicio'
                  : 'Fill out a simple form with your product or service information'
              },
              {
                step: '02',
                title: language === 'es' ? 'Selecciona estructura' : 'Select structure',
                description: language === 'es'
                  ? 'Elige entre 5 estructuras maestras, duración y número de variaciones'
                  : 'Choose from 5 master structures, duration and number of variations'
              },
              {
                step: '03',
                title: language === 'es' ? 'Genera y mejora' : 'Generate and improve',
                description: language === 'es'
                  ? 'La IA genera tus guiones. Itera con feedback hasta que estén perfectos'
                  : 'AI generates your scripts. Iterate with feedback until they\'re perfect'
              }
            ].map((item, i) => (
              <div key={i} className="relative">
                <div className="text-6xl font-bold text-primary-100 mb-4">{item.step}</div>
                <h3 className="text-xl font-semibold text-dark-900 mb-2">{item.title}</h3>
                <p className="text-dark-600">{item.description}</p>
                {i < 2 && (
                  <div className="hidden md:block absolute top-8 right-0 transform translate-x-1/2">
                    <ArrowRight className="w-6 h-6 text-primary-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-100 border border-primary-200 rounded-full mb-4">
              <span className="text-sm text-primary-700 font-medium">{labels.pricing.badge}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4">
              {labels.pricing.title}
            </h2>
            <p className="text-lg text-dark-600 max-w-2xl mx-auto">
              {labels.pricing.subtitle}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Single Plan */}
            <div className="bg-white border border-dark-100 rounded-2xl p-8 hover:shadow-lg transition-all">
              <h3 className="text-xl font-semibold text-dark-900 mb-2">{labels.pricing.single.name}</h3>
              <p className="text-dark-500 mb-6">{labels.pricing.single.description}</p>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold text-dark-900">{labels.pricing.single.price}</span>
                <span className="text-dark-500">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-3 px-4 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 mb-8"
              >
                {labels.pricing.single.cta}
              </Link>
              <ul className="space-y-3">
                {labels.pricing.single.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Team Plan */}
            <div className="bg-gradient-to-b from-primary-50 to-white border-2 border-primary-200 rounded-2xl p-8 relative shadow-lg">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="px-3 py-1 bg-primary-600 rounded-full text-sm font-medium text-white">
                  {labels.pricing.team.badge}
                </div>
              </div>
              <h3 className="text-xl font-semibold text-dark-900 mb-2">{labels.pricing.team.name}</h3>
              <p className="text-dark-500 mb-6">{labels.pricing.team.description}</p>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold text-dark-900">{labels.pricing.team.price}</span>
                <span className="text-dark-500">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 mb-8"
              >
                {labels.pricing.team.cta}
              </Link>
              <ul className="space-y-3">
                {labels.pricing.team.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 mb-4">
              {language === 'es' ? 'Lo que dicen nuestros usuarios' : 'What our users say'}
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                quote: language === 'es' 
                  ? 'Pasé de escribir guiones en 2 horas a tenerlos listos en 5 minutos. La calidad es increíble.'
                  : 'I went from writing scripts in 2 hours to having them ready in 5 minutes. The quality is incredible.',
                author: 'María García',
                role: language === 'es' ? 'Marketing Manager' : 'Marketing Manager'
              },
              {
                quote: language === 'es'
                  ? 'Las estructuras maestras realmente funcionan. Mis videos tienen 3x más engagement.'
                  : 'The master structures really work. My videos have 3x more engagement.',
                author: 'Carlos Rodríguez',
                role: language === 'es' ? 'Creador de Contenido' : 'Content Creator'
              },
              {
                quote: language === 'es'
                  ? 'Perfecto para mi agencia. Generamos contenido para 20 clientes en tiempo récord.'
                  : 'Perfect for my agency. We generate content for 20 clients in record time.',
                author: 'Ana Martínez',
                role: language === 'es' ? 'Dueña de Agencia' : 'Agency Owner'
              }
            ].map((testimonial, i) => (
              <div key={i} className="bg-dark-50 border border-dark-100 rounded-2xl p-6">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="w-5 h-5 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-dark-700 mb-6 leading-relaxed">"{testimonial.quote}"</p>
                <div>
                  <div className="font-medium text-dark-900">{testimonial.author}</div>
                  <div className="text-sm text-dark-500">{testimonial.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-gradient-to-r from-primary-600 to-sky-500 rounded-3xl p-12 text-white">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              {labels.cta.title}
            </h2>
            <p className="text-lg text-primary-100 mb-8 max-w-2xl mx-auto">
              {labels.cta.subtitle}
            </p>
            <Link 
              to="/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-primary-600 rounded-xl font-semibold text-lg transition-all hover:bg-primary-50 group"
            >
              {labels.cta.button}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <p className="text-sm text-primary-200 mt-4">{labels.cta.note}</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-white border-t border-dark-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Advance AI" className="w-8 h-8 object-contain rounded-lg" />
              <span className="font-bold italic" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
              <span className="text-dark-400">• {labels.footer.tagline}</span>
            </div>
            <p className="text-dark-500 text-sm">{labels.footer.rights}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
