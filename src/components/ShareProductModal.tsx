import { useState, useEffect } from 'react'
import { X, UserPlus, Trash2, Eye, Pencil, Loader2, Mail, Share2 } from 'lucide-react'
import {
  getProductCollaborators,
  inviteCollaborator,
  updateCollaboratorRole,
  removeCollaborator
} from '../services/database'
import type { ProductCollaborator } from '../services/database'

interface ShareProductModalProps {
  productId: string
  productName: string
  userId: string
  language: 'es' | 'en'
  onClose: () => void
}

export default function ShareProductModal({
  productId,
  productName,
  userId,
  language,
  onClose
}: ShareProductModalProps) {
  const [collaborators, setCollaborators] = useState<ProductCollaborator[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor'>('viewer')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const t = language === 'es' ? {
    title: 'Compartir',
    subtitle: 'Invita personas a colaborar en este producto',
    emailPlaceholder: 'correo@ejemplo.com',
    invite: 'Invitar',
    viewer: 'Lector',
    editor: 'Editor',
    viewerDesc: 'Solo ver guiones y posts',
    editorDesc: 'Puede generar guiones y posts',
    pending: 'Pendiente',
    accepted: 'Activo',
    remove: 'Eliminar',
    noCollaborators: 'Aún no has compartido este producto',
    inviteSent: 'Invitación enviada',
    alreadyInvited: 'Este email ya fue invitado',
    invalidEmail: 'Ingresa un email válido',
    cantInviteSelf: 'No puedes invitarte a ti mismo',
    collaborators: 'Colaboradores',
    role: 'Rol'
  } : {
    title: 'Share',
    subtitle: 'Invite people to collaborate on this product',
    emailPlaceholder: 'email@example.com',
    invite: 'Invite',
    viewer: 'Viewer',
    editor: 'Editor',
    viewerDesc: 'Can only view scripts and posts',
    editorDesc: 'Can generate scripts and posts',
    pending: 'Pending',
    accepted: 'Active',
    remove: 'Remove',
    noCollaborators: "You haven't shared this product yet",
    inviteSent: 'Invitation sent',
    alreadyInvited: 'This email was already invited',
    invalidEmail: 'Enter a valid email',
    cantInviteSelf: "You can't invite yourself",
    collaborators: 'Collaborators',
    role: 'Role'
  }

  useEffect(() => {
    loadCollaborators()
  }, [productId])

  async function loadCollaborators() {
    try {
      setLoading(true)
      const data = await getProductCollaborators(productId)
      setCollaborators(data)
    } catch {
      console.error('Failed to load collaborators')
    } finally {
      setLoading(false)
    }
  }

  async function handleInvite() {
    setError('')
    setSuccess('')

    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setError(t.invalidEmail)
      return
    }

    try {
      setInviting(true)
      await inviteCollaborator(productId, email, inviteRole, userId)
      setInviteEmail('')
      setSuccess(t.inviteSent)
      await loadCollaborators()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('duplicate') || msg.includes('unique')) {
        setError(t.alreadyInvited)
      } else {
        setError(msg || 'Error')
      }
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(collab: ProductCollaborator, newRole: 'viewer' | 'editor') {
    try {
      await updateCollaboratorRole(collab.id, newRole)
      setCollaborators(prev => prev.map(c => c.id === collab.id ? { ...c, role: newRole } : c))
    } catch {
      console.error('Failed to update role')
    }
  }

  async function handleRemove(collab: ProductCollaborator) {
    try {
      await removeCollaborator(collab.id)
      setCollaborators(prev => prev.filter(c => c.id !== collab.id))
    } catch {
      console.error('Failed to remove collaborator')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-100 rounded-2xl shadow-2xl border border-dark-200 w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-dark-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-dark-900 flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary-500" />
              {t.title}
            </h2>
            <p className="text-xs text-dark-400 mt-0.5 truncate max-w-[280px]">{productName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-dark-50 rounded-lg text-dark-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Invite form */}
        <div className="p-5 border-b border-dark-200">
          <p className="text-sm text-dark-500 mb-3">{t.subtitle}</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
              <input
                type="email"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                placeholder={t.emailPlaceholder}
                className="w-full pl-9 pr-3 py-2.5 bg-dark-50 border border-dark-200 rounded-xl text-sm text-dark-900 placeholder:text-dark-400 focus:outline-none focus:border-primary-400"
              />
            </div>
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as 'viewer' | 'editor')}
              className="bg-dark-50 border border-dark-200 rounded-xl text-sm text-dark-700 px-2 py-2.5 focus:outline-none focus:border-primary-400"
            >
              <option value="viewer">{t.viewer}</option>
              <option value="editor">{t.editor}</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {t.invite}
            </button>
          </div>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          {success && <p className="text-xs text-green-400 mt-2">{success}</p>}
        </div>

        {/* Collaborators list */}
        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">{t.collaborators}</h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-dark-400" />
            </div>
          ) : collaborators.length === 0 ? (
            <p className="text-sm text-dark-400 text-center py-6">{t.noCollaborators}</p>
          ) : (
            <div className="space-y-2">
              {collaborators.map(collab => (
                <div
                  key={collab.id}
                  className="flex items-center justify-between p-3 bg-dark-50 rounded-xl"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-full bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-primary-600">
                        {collab.invited_email[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-dark-800 truncate">{collab.invited_email}</p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        collab.status === 'accepted'
                          ? 'bg-green-900/20 text-green-600'
                          : 'bg-amber-900/20 text-amber-600'
                      }`}>
                        {collab.status === 'accepted' ? t.accepted : t.pending}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      value={collab.role}
                      onChange={e => handleRoleChange(collab, e.target.value as 'viewer' | 'editor')}
                      className="bg-dark-100 border border-dark-200 rounded-lg text-xs text-dark-600 px-2 py-1.5 focus:outline-none"
                    >
                      <option value="viewer">{t.viewer}</option>
                      <option value="editor">{t.editor}</option>
                    </select>
                    <button
                      onClick={() => handleRemove(collab)}
                      className="p-1.5 text-dark-300 hover:text-red-500 hover:bg-red-900/20 rounded-lg transition-colors"
                      title={t.remove}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Role legend */}
        <div className="p-4 border-t border-dark-200 bg-dark-50/50">
          <div className="flex gap-4 text-[11px] text-dark-400">
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {t.viewer}: {t.viewerDesc}</span>
            <span className="flex items-center gap-1"><Pencil className="w-3 h-3" /> {t.editor}: {t.editorDesc}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
