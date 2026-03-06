import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getOnboardingStatus, markOnboardingComplete } from '../services/database'

export type OnboardingStep =
  | 'welcome'
  | 'dashboard'
  | 'scripts'
  | 'posts'
  | 'descriptions'
  | 'settings'
  | 'feedback'
  | 'complete'

const STEPS: OnboardingStep[] = [
  'welcome',
  'dashboard',
  'scripts',
  'posts',
  'descriptions',
  'settings',
  'feedback',
  'complete',
]

interface UseOnboardingReturn {
  showWizard: boolean
  currentStep: OnboardingStep
  stepIndex: number
  totalSteps: number
  nextStep: () => void
  prevStep: () => void
  skipAll: () => void
  startWizard: () => void
  loading: boolean
}

export function useOnboarding(): UseOnboardingReturn {
  const { user } = useAuth()
  const [showWizard, setShowWizard] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!user || checked) return

    async function check() {
      try {
        const completed = await getOnboardingStatus(user!.id)
        if (!completed) {
          setShowWizard(true)
        }
      } catch (err) {
        console.error('Failed to check onboarding status:', err)
      } finally {
        setLoading(false)
        setChecked(true)
      }
    }
    check()
  }, [user?.id, checked])

  const finish = useCallback(async () => {
    setShowWizard(false)
    setStepIndex(0)
    if (user) {
      try {
        await markOnboardingComplete(user.id)
      } catch (err) {
        console.error('Failed to mark onboarding complete:', err)
      }
    }
  }, [user?.id])

  const nextStep = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      finish()
    } else {
      setStepIndex(prev => prev + 1)
    }
  }, [stepIndex, finish])

  const prevStep = useCallback(() => {
    if (stepIndex > 0) {
      setStepIndex(prev => prev - 1)
    }
  }, [stepIndex])

  const skipAll = useCallback(() => {
    finish()
  }, [finish])

  const startWizard = useCallback(() => {
    setStepIndex(0)
    setShowWizard(true)
  }, [])

  return {
    showWizard,
    currentStep: STEPS[stepIndex],
    stepIndex,
    totalSteps: STEPS.length,
    nextStep,
    prevStep,
    skipAll,
    startWizard,
    loading,
  }
}
