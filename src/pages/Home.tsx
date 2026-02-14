import { Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { 
  Check, 
  ArrowRight,
  Sparkles,
  TrendingDown,
  UserCheck,
  BarChart3,
  FileText,
  PenTool,
  Users,
  Image,
  Video,
  ChevronRight,
  Play,
  Heart,
  Eye
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
        subtitle: 'Advance AI es un generador de guiones entrenado con +1K anuncios ganadores, con enfoque en ventas.',
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
        steps: [
          'Solo nos das el contexto de tu negocio',
          'Te entregamos guiones ganadores listos para grabar'
        ]
      },
      socialProof: {
        title: 'Creado con Advance AI',
        metaAds: 'Meta Ads – Resultados',
        chatMessages: 'Mensajes de chat reales'
      },
      flow: {
        title: 'El flujo que genera ventas',
        steps: ['Meta Ads', 'Mensaje de cliente', 'Video', 'Ventas']
      },
      reinforcement: 'Hacemos que vender por redes sociales sea más fácil',
      pricing: {
        badge: 'Precios',
        title: 'Planes simples, resultados reales',
        subtitle: 'Elegí el plan que mejor se adapte a tu negocio.',
        monthly: '/mes',
        starter: {
          name: 'Starter',
          price: '$27',
          features: [
            'Guiones ilimitados'
          ],
          cta: 'Comenzar'
        },
        pro: {
          name: 'Pro',
          price: '$99',
          badge: 'Más popular',
          features: [
            'Guiones ilimitados',
            'IA + integraciones',
            '30 posts generados con IA',
            '10 videos generados con IA'
          ],
          cta: 'Comenzar'
        },
        teams: {
          name: 'Teams',
          features: [
            'Todo en Pro',
            'Gestión de clientes',
            'Colaboración en equipo',
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
          'Genera posts personalizados para redes sociales',
          'Generación de videos con IA'
        ]
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
        subtitle: 'Advance AI is a script generator trained with +1K winning ads, focused on sales.',
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
        steps: [
          'Just give us the context of your business',
          'We deliver winning scripts ready to record'
        ]
      },
      socialProof: {
        title: 'Created with Advance AI',
        metaAds: 'Meta Ads – Results',
        chatMessages: 'Real chat messages'
      },
      flow: {
        title: 'The flow that drives sales',
        steps: ['Meta Ads', 'Client message', 'Video', 'Sales']
      },
      reinforcement: 'We make selling on social media easier',
      pricing: {
        badge: 'Pricing',
        title: 'Simple plans, real results',
        subtitle: 'Choose the plan that best fits your business.',
        monthly: '/mo',
        starter: {
          name: 'Starter',
          price: '$27',
          features: [
            'Unlimited scripts'
          ],
          cta: 'Get Started'
        },
        pro: {
          name: 'Pro',
          price: '$99',
          badge: 'Most popular',
          features: [
            'Unlimited scripts',
            'AI + integrations',
            '30 AI-generated posts',
            '10 AI-generated videos'
          ],
          cta: 'Get Started'
        },
        teams: {
          name: 'Teams',
          features: [
            'Everything in Pro',
            'Client management',
            'Team collaboration',
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
          'Generate personalized posts for social media',
          'AI video generation'
        ]
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

  const featureIcons = [
    <FileText className="w-6 h-6" />,
    <PenTool className="w-6 h-6" />,
    <Users className="w-6 h-6" />,
    <Image className="w-6 h-6" />,
    <Video className="w-6 h-6" />
  ]

  const reelCards = [
    { color: 'from-rose-400 to-pink-500', views: '2.4M', likes: '184K', pos: 'left-[2%] top-[15%]', anim: 'animate-float-up', delay: '' },
    { color: 'from-violet-400 to-purple-500', views: '890K', likes: '72K', pos: 'left-[8%] top-[55%]', anim: 'animate-float-down', delay: 'animation-delay-2' },
    { color: 'from-amber-400 to-orange-500', views: '1.1M', likes: '95K', pos: 'right-[2%] top-[20%]', anim: 'animate-float-slow', delay: 'animation-delay-1' },
    { color: 'from-emerald-400 to-teal-500', views: '3.2M', likes: '210K', pos: 'right-[8%] top-[58%]', anim: 'animate-float-up', delay: 'animation-delay-3' },
    { color: 'from-sky-400 to-blue-500', views: '567K', likes: '41K', pos: 'left-[18%] top-[35%]', anim: 'animate-float-down', delay: 'animation-delay-4' },
    { color: 'from-fuchsia-400 to-pink-600', views: '1.8M', likes: '132K', pos: 'right-[18%] top-[40%]', anim: 'animate-float-slow', delay: 'animation-delay-2' },
  ]

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-dark-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Advance AI" className="w-10 h-10 object-contain rounded-xl" />
              <span className="text-xl font-bold italic" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
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
      <section className="relative pt-28 pb-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-primary-50 via-white to-white overflow-hidden min-h-[90vh] flex items-center">
        {/* Ambient glow */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/5 rounded-full blur-3xl animate-pulse-soft" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl animate-pulse-soft animation-delay-2" />
        </div>

        {/* Floating Reel Cards — hidden on mobile for cleanliness */}
        <div className="hidden lg:block absolute inset-0 pointer-events-none">
          {reelCards.map((card, i) => (
            <div
              key={i}
              className={`absolute ${card.pos} ${card.anim} ${card.delay}`}
              style={{ opacity: 0.45 }}
            >
              <div className="w-[100px] rounded-2xl overflow-hidden shadow-xl border border-dark-100 bg-white/90 backdrop-blur-sm">
                {/* Video thumbnail */}
                <div className={`h-[140px] bg-gradient-to-br ${card.color} relative`}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 bg-white/30 backdrop-blur-sm rounded-full flex items-center justify-center">
                      <Play className="w-4 h-4 text-white fill-white" />
                    </div>
                  </div>
                </div>
                {/* Engagement bar */}
                <div className="px-2 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Heart className="w-3 h-3 text-rose-400" />
                    <span className="text-[9px] text-dark-500 font-medium">{card.likes}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Eye className="w-3 h-3 text-dark-400" />
                    <span className="text-[9px] text-dark-500 font-medium">{card.views}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Hero Content */}
        <div className="max-w-7xl mx-auto relative z-10 w-full">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-dark-900 mb-6 leading-[1.1] tracking-tight animate-fade-in-up">
              {labels.hero.title}{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-sky-500">
                {labels.hero.titleHighlight}
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-dark-500 mb-10 max-w-xl mx-auto leading-relaxed animate-fade-in-up animation-delay-1">
              {labels.hero.subtitle}
            </p>

            <div className="flex justify-center animate-fade-in-up animation-delay-2">
              <Link 
                to="/signup" 
                className="px-10 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-semibold text-lg transition-all shadow-lg shadow-primary-500/25 flex items-center gap-3 group"
              >
                {labels.hero.cta}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>

            {/* Subtle social proof line */}
            <div className="mt-12 flex items-center justify-center gap-6 animate-fade-in-up animation-delay-3">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {['bg-primary-400', 'bg-sky-400', 'bg-emerald-400', 'bg-amber-400'].map((bg, i) => (
                    <div key={i} className={`w-7 h-7 rounded-full ${bg} border-2 border-white`} />
                  ))}
                </div>
                <span className="text-sm text-dark-500">
                  {language === 'es' ? '+500 negocios activos' : '+500 active businesses'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 text-center mb-14">
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
                  <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    {icons[i]}
                  </div>
                  <p className="text-lg text-dark-700 font-medium pt-2">{benefit}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Features List Section — moved up */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-50/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-100 border border-primary-200 rounded-full">
              <Sparkles className="w-4 h-4 text-primary-600" />
              <span className="text-sm text-primary-700 font-medium">{labels.features.badge}</span>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {labels.features.list.map((feature, i) => (
              <div 
                key={i}
                className="flex flex-col items-center text-center gap-4 bg-white border border-dark-100 rounded-2xl p-6 hover:border-primary-200 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group"
              >
                <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center flex-shrink-0 text-primary-600 group-hover:bg-primary-600 group-hover:text-white transition-all duration-300">
                  {featureIcons[i]}
                </div>
                <span className="text-base text-dark-700 font-medium leading-snug">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof / Mockup Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-50/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-dark-900 text-center mb-3">
            {labels.socialProof.title}
          </h2>
          <p className="text-dark-500 text-center mb-14 text-lg">
            {language === 'es' ? 'Resultados reales generados por nuestra IA' : 'Real results generated by our AI'}
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Meta Ads Mockup */}
            <div className="bg-white rounded-2xl border border-dark-100 shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-300">
              <div className="px-6 py-4 bg-dark-50 border-b border-dark-100">
                <span className="text-sm font-semibold text-dark-700">{labels.socialProof.metaAds}</span>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-dark-500">{language === 'es' ? 'Costo por lead' : 'Cost per lead'}</span>
                  <span className="text-2xl font-bold text-green-600">$2.40</span>
                </div>
                <div className="h-px bg-dark-100" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-dark-500">{language === 'es' ? 'Conversiones' : 'Conversions'}</span>
                  <span className="text-2xl font-bold text-primary-600">147</span>
                </div>
                <div className="h-px bg-dark-100" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-dark-500">ROAS</span>
                  <span className="text-2xl font-bold text-primary-600">4.2x</span>
                </div>
                <div className="mt-4 flex gap-2">
                  {[40, 65, 55, 80, 70, 90, 85].map((h, i) => (
                    <div key={i} className="flex-1 bg-primary-100 rounded-t-sm flex flex-col justify-end" style={{ height: '80px' }}>
                      <div className="bg-primary-500 rounded-t-sm transition-all duration-500" style={{ height: `${h}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Chat Messages Mockup */}
            <div className="bg-white rounded-2xl border border-dark-100 shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-300">
              <div className="px-6 py-4 bg-dark-50 border-b border-dark-100">
                <span className="text-sm font-semibold text-dark-700">{labels.socialProof.chatMessages}</span>
              </div>
              <div className="p-6 space-y-3">
                <div className="flex justify-end">
                  <div className="bg-primary-500 text-white rounded-2xl rounded-br-md px-4 py-3 max-w-[80%]">
                    <p className="text-sm">{language === 'es' ? 'Hola! Vi tu video sobre el tratamiento. Me interesa saber más' : 'Hi! I saw your video about the treatment. I\'d like to know more'}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-primary-500 text-white rounded-2xl rounded-br-md px-4 py-3 max-w-[80%]">
                    <p className="text-sm">{language === 'es' ? 'Quiero agendar una cita para esta semana' : 'I want to schedule an appointment this week'}</p>
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-dark-100 text-dark-700 rounded-2xl rounded-bl-md px-4 py-3 max-w-[80%]">
                    <p className="text-sm">{language === 'es' ? 'Claro! Te agendo para el jueves a las 3pm' : 'Sure! I\'ll schedule you for Thursday at 3pm'}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-primary-500 text-white rounded-2xl rounded-br-md px-4 py-3 max-w-[80%]">
                    <p className="text-sm">{language === 'es' ? 'Perfecto, ahí estaré!' : 'Perfect, I\'ll be there!'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Visual Flow */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-dark-900 text-center mb-12">
            {labels.flow.title}
          </h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-0">
            {labels.flow.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="px-8 py-4 bg-dark-50 border border-dark-200 rounded-2xl shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-300">
                  <span className="font-semibold text-dark-800">{step}</span>
                </div>
                {i < labels.flow.steps.length - 1 && (
                  <ChevronRight className="w-5 h-5 text-primary-400 hidden sm:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reinforcement Phrase */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-50/50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-sky-500 leading-tight">
            {labels.reinforcement}
          </h2>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8 bg-white">
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

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Starter Plan */}
            <div className="bg-white border border-dark-100 rounded-2xl p-8 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <h3 className="text-xl font-semibold text-dark-900 mb-2">{labels.pricing.starter.name}</h3>
              <div className="flex items-baseline gap-1 mb-6 mt-2">
                <span className="text-4xl font-bold text-dark-900">{labels.pricing.starter.price}</span>
                <span className="text-dark-500">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-3 px-4 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 mb-8"
              >
                {labels.pricing.starter.cta}
              </Link>
              <ul className="space-y-3 flex-1">
                {labels.pricing.starter.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Pro Plan */}
            <div className="bg-gradient-to-b from-primary-50 to-white border-2 border-primary-200 rounded-2xl p-8 relative shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="px-4 py-1 bg-primary-600 rounded-full text-sm font-medium text-white shadow-lg shadow-primary-500/30">
                  {labels.pricing.pro.badge}
                </div>
              </div>
              <h3 className="text-xl font-semibold text-dark-900 mb-2">{labels.pricing.pro.name}</h3>
              <div className="flex items-baseline gap-1 mb-6 mt-2">
                <span className="text-4xl font-bold text-dark-900">{labels.pricing.pro.price}</span>
                <span className="text-dark-500">{labels.pricing.monthly}</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 mb-8"
              >
                {labels.pricing.pro.cta}
              </Link>
              <ul className="space-y-3 flex-1">
                {labels.pricing.pro.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-dark-600">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Teams Plan */}
            <div className="bg-white border border-dark-100 rounded-2xl p-8 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <h3 className="text-xl font-semibold text-dark-900 mb-2">{labels.pricing.teams.name}</h3>
              <div className="flex items-baseline gap-1 mb-6 mt-2">
                <span className="text-4xl font-bold text-dark-900">Custom</span>
              </div>
              <Link 
                to="/signup"
                className="w-full py-3 px-4 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 mb-8"
              >
                {labels.pricing.teams.cta}
              </Link>
              <ul className="space-y-3 flex-1">
                {labels.pricing.teams.features.map((feature, i) => (
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

      {/* Final CTA */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-50/50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 rounded-3xl p-14 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl" />
            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                {labels.cta.title}
              </h2>
              <p className="text-lg text-dark-300 mb-10 max-w-2xl mx-auto">
                {labels.cta.subtitle}
              </p>
              <Link 
                to="/signup"
                className="inline-flex items-center gap-2 px-8 py-4 bg-white text-dark-900 rounded-2xl font-semibold text-lg transition-all hover:bg-dark-50 shadow-2xl shadow-white/10 group"
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
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-white border-t border-dark-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Advance AI" className="w-8 h-8 object-contain rounded-lg" />
              <span className="font-bold italic" style={{ fontFamily: 'Montserrat, sans-serif', color: '#0284c7', letterSpacing: '-0.02em' }}>Advance AI</span>
              <span className="text-dark-400 text-sm">• {labels.footer.tagline}</span>
            </div>
            <p className="text-dark-400 text-sm">{labels.footer.rights}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
