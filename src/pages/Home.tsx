import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import {
  HOME_AUTH_REDIRECT,
  HOME_FAN_CARDS,
  HOME_FEATURES,
  HOME_GALLERY,
  HOME_PLANS,
} from './homeContent'
import './home.css'

function CyanMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2.2 22 20.8H2L12 2.2Z" />
    </svg>
  )
}

export default function Home() {
  const { language } = useLanguage()
  const lang = language === 'en' ? 'en' : 'es'
  const [fanReady, setFanReady] = useState(false)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setFanReady(true)
      return
    }
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setFanReady(true))
    })
    return () => window.cancelAnimationFrame(id)
  }, [])

  const t = {
    es: {
      features: 'Funcionalidades',
      pricing: 'Precios',
      login: 'Iniciar Sesión',
      signup: 'Empezá hoy',
      heroTitle: 'Tu nueva herramienta para crear',
      heroAccent: 'anuncios ganadores',
      heroSub: 'Guiones, posts y fotos de agencia. En un chat.',
      galleryKicker: 'Galería',
      galleryTitle: 'Lo que generan las agencias',
      featuresKicker: 'Funcionalidades',
      featuresTitle: 'Todo en un chat',
      pricingKicker: 'Precios',
      pricingTitle: 'Planes simples, resultados reales',
      monthly: '/mes',
      popular: 'Más popular',
      creditNote: 'Guion = 3 · Imagen = 6 · Pro = 24',
      finalTitle: 'Empezá a crear anuncios que venden',
      finalSub: 'Entrá al chat. Tu marca primero.',
      rights: `© ${new Date().getFullYear()} Advance AI. Todos los derechos reservados.`,
    },
    en: {
      features: 'Features',
      pricing: 'Pricing',
      login: 'Log in',
      signup: 'Get started',
      heroTitle: 'Your new tool to create',
      heroAccent: 'winning ads',
      heroSub: 'Agency scripts, posts, and photos. In one chat.',
      galleryKicker: 'Gallery',
      galleryTitle: 'What agencies ship',
      featuresKicker: 'Features',
      featuresTitle: 'All in one chat',
      pricingKicker: 'Pricing',
      pricingTitle: 'Simple plans, real results',
      monthly: '/mo',
      popular: 'Most popular',
      creditNote: 'Script = 3 · Image = 6 · Pro = 24',
      finalTitle: 'Start creating ads that sell',
      finalSub: 'Enter the chat. Brand first.',
      rights: `© ${new Date().getFullYear()} Advance AI. All rights reserved.`,
    },
  }[lang]

  const chatSignup = `/signup?redirect=${encodeURIComponent(HOME_AUTH_REDIRECT)}`
  const chatLogin = `/login?redirect=${encodeURIComponent(HOME_AUTH_REDIRECT)}`

  return (
    <div className="home-page">
      <nav className="home-nav" aria-label="Advance AI">
        <Link to="/" className="home-nav__brand">
          <CyanMark className="home-nav__mark" />
          <span>Advance AI</span>
        </Link>
        <div className="home-nav__links">
          <a href="#features">{t.features}</a>
          <a href="#pricing">{t.pricing}</a>
          <Link to={chatLogin}>{t.login}</Link>
        </div>
        <div className="home-nav__actions">
          <Link to={chatLogin} className="home-nav__login home-nav__login--mobile">
            {t.login}
          </Link>
          <Link to={chatSignup} className="home-nav__cta">
            {t.signup}
          </Link>
        </div>
      </nav>

      <section className="home-hero" aria-label="Hero">
        <div className="home-hero__copy">
          <h1 className="home-hero__title">
            {t.heroTitle}{' '}
            <span className="home-hero__title-accent">{t.heroAccent}</span>
          </h1>
          <p className="home-hero__sub">{t.heroSub}</p>
          <div className="home-hero__cta">
            <Link to={chatSignup} className="home-btn home-btn--primary">
              {t.signup}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <div className="home-hero__fan-wrap">
          <div className={`home-fan${fanReady ? ' is-spread' : ''}`} aria-hidden="true">
            {HOME_FAN_CARDS.map((card) => (
              <div
                key={card.id}
                className={[
                  'home-fan__card',
                  card.slot === 'front' ? 'home-fan__card--front is-glow' : '',
                  card.mobile ? '' : 'home-fan__card--desktop-only',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-slot={card.slot}
              >
                <img src={card.src} alt="" loading={card.slot === 'front' ? 'eager' : 'lazy'} decoding="async" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section" aria-labelledby="gallery-title">
        <p className="home-kicker">{t.galleryKicker}</p>
        <h2 id="gallery-title" className="home-section__title">
          {t.galleryTitle}
        </h2>
        <div className="home-gallery">
          {HOME_GALLERY.map((item) => (
            <figure key={`${item.src}-${item.kind}`} className="home-gallery__item">
              <img src={item.src} alt="" loading="lazy" decoding="async" />
              <figcaption className="home-gallery__label">
                {item.industry[lang]} · {item.kind}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="home-section" id="features" aria-labelledby="features-title">
        <p className="home-kicker">{t.featuresKicker}</p>
        <h2 id="features-title" className="home-section__title">
          {t.featuresTitle}
        </h2>
        <div className="home-features">
          {HOME_FEATURES.map((feature) => (
            <article key={feature.num} className="home-feature">
              <div className="home-feature__num">{feature.num}</div>
              <h3 className="home-feature__title">{feature.title[lang]}</h3>
              <p className="home-feature__body">{feature.body[lang]}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" id="pricing" aria-labelledby="pricing-title">
        <p className="home-kicker">{t.pricingKicker}</p>
        <h2 id="pricing-title" className="home-section__title">
          {t.pricingTitle}
        </h2>
        <div className="home-pricing">
          {HOME_PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`home-plan${plan.popular ? ' home-plan--popular' : ''}`}
            >
              {plan.popular ? <div className="home-plan__badge">{t.popular}</div> : null}
              <div>
                <h3 className="home-plan__name">{plan.name}</h3>
                <p className="home-plan__price">
                  {plan.price}
                  <span>{t.monthly}</span>
                </p>
                <p className="home-plan__credits">{plan.credits[lang]}</p>
              </div>
              {plan.contact ? (
                <a
                  href="mailto:hola@advance.ai"
                  className="home-btn home-plan__cta home-btn--ghost"
                >
                  {plan.cta[lang]}
                </a>
              ) : (
                <Link
                  to={chatSignup}
                  className={`home-btn home-plan__cta ${
                    plan.popular ? 'home-btn--filled-dark' : 'home-btn--ghost'
                  }`}
                >
                  {plan.cta[lang]}
                </Link>
              )}
            </article>
          ))}
        </div>
        <p className="home-pricing__note">{t.creditNote}</p>
      </section>

      <section className="home-final">
        <h2 className="home-final__title">{t.finalTitle}</h2>
        <p className="home-final__sub">{t.finalSub}</p>
        <Link to={chatSignup} className="home-btn home-btn--primary">
          {t.signup}
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <footer className="home-footer">{t.rights}</footer>
    </div>
  )
}
