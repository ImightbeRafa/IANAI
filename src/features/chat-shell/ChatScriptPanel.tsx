import { FileText } from 'lucide-react'
import ScriptSettingsPanel from '../../components/ScriptSettingsPanel'
import type { ScriptGenerationSettings } from '../../types'
import type { ChatShellLanguage } from './chatShellLabels'

interface ChatScriptPanelProps {
  language: ChatShellLanguage
  settings: ScriptGenerationSettings
  onChange: (settings: ScriptGenerationSettings) => void
  onGenerate: () => void
  sending: boolean
}

export default function ChatScriptPanel({
  language,
  settings,
  onChange,
  onGenerate,
  sending,
}: ChatScriptPanelProps) {
  return (
    <div className="chat-shell__rail-form chat-shell__tool-panel">
      <div className="chat-shell__tool-panel-head">
        <FileText size={16} />
        <div>
          <strong>{language === 'es' ? 'Ajustes de guiones' : 'Script settings'}</strong>
          <p>{language === 'es'
            ? 'Estos ajustes se aplican al próximo pedido que hagas en el chat.'
            : 'These settings apply to your next request in chat.'}</p>
        </div>
      </div>
      <ScriptSettingsPanel
        settings={settings}
        onChange={onChange}
        language={language}
        onGenerate={onGenerate}
        loading={sending}
      />
    </div>
  )
}
