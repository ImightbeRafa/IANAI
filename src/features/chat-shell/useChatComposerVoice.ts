import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

export function appendComposerTranscript(existing: string, incoming: string): string {
  const next = incoming.trim()
  if (!next) return existing
  const base = existing.trimEnd()
  return base ? `${base} ${next}` : next
}

export function transcribeAudioUrl(): string {
  return import.meta.env.PROD
    ? '/api/transcribe-audio'
    : 'http://localhost:3000/api/transcribe-audio'
}

export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return 'audio/webm'
}

export function isComposerVoiceSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
}

interface UseChatComposerVoiceOptions {
  language: 'en' | 'es'
  enabled: boolean
  onTranscript: (text: string) => void
}

export function useChatComposerVoice({
  language,
  enabled,
  onTranscript,
}: UseChatComposerVoiceOptions) {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const discard = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        try {
          recorder.stop()
        } catch {
          /* already stopped */
        }
      }
    }
    recorderRef.current = null
    chunksRef.current = []
    stopTracks()
    setIsRecording(false)
    setIsTranscribing(false)
  }, [stopTracks])

  useEffect(() => () => {
    discard()
  }, [discard])

  const toggle = useCallback(async () => {
    if (!enabled) return

    if (isRecording) {
      recorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    if (!isComposerVoiceSupported()) {
      setError(language === 'es'
        ? 'El micrófono no está disponible en este navegador'
        : 'Microphone is not available in this browser')
      return
    }

    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickRecorderMimeType()
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        stopTracks()
        const blob = new Blob(chunksRef.current, { type: mimeType })
        if (blob.size < 100) return

        setIsTranscribing(true)
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => {
              const result = reader.result
              if (typeof result !== 'string') {
                reject(new Error('read failed'))
                return
              }
              resolve(result.split(',')[1] || '')
            }
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(blob)
          })

          const { data: { session: authSession } } = await supabase.auth.getSession()
          const token = authSession?.access_token
          const response = await fetch(transcribeAudioUrl(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              audio: base64,
              mimeType: mimeType.split(';')[0],
              language,
            }),
          })
          const result = await response.json().catch(() => ({}))
          if (response.ok && typeof result.text === 'string' && result.text.trim()) {
            onTranscriptRef.current(result.text)
            return
          }
          setError(language === 'es'
            ? 'No pude transcribir el audio. Probá de nuevo.'
            : 'Could not transcribe the audio. Try again.')
        } catch {
          setError(language === 'es'
            ? 'No pude transcribir el audio. ¿Está corriendo la API local?'
            : 'Could not transcribe the audio. Is the local API running?')
        } finally {
          setIsTranscribing(false)
        }
      }

      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      stopTracks()
      setError(language === 'es'
        ? 'No pude acceder al micrófono. Revisá los permisos.'
        : 'Could not access the microphone. Check permissions.')
    }
  }, [enabled, isRecording, language, stopTracks])

  return {
    isRecording,
    isTranscribing,
    error,
    supported: isComposerVoiceSupported(),
    toggle,
    discard,
  }
}
