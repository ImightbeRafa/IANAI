import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getTeam, getTeamMembers, inviteTeamMember, removeTeamMember } from '../services/database'
import type { Team, TeamMember } from '../types'
import Layout from '../components/Layout'
import { 
  Users, 
  Mail, 
  UserPlus, 
  Trash2, 
  Crown, 
  Shield, 
  User,
  AlertCircle,
  CheckCircle,
  Loader2,
  ArrowLeft
} from 'lucide-react'
import { Link } from 'react-router-dom'

export default function TeamManagement() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const isOwner = team?.owner_id === user?.id

  const t = {
    es: {
      title: 'Gestión de Equipo',
      subtitle: 'Administra los miembros de tu equipo',
      members: 'Miembros del Equipo',
      inviteMember: 'Invitar Miembro',
      emailPlaceholder: 'correo@ejemplo.com',
      invite: 'Invitar',
      inviting: 'Invitando...',
      remove: 'Eliminar',
      owner: 'Propietario',
      admin: 'Administrador',
      member: 'Miembro',
      you: '(Tú)',
      confirmRemove: '¿Eliminar este miembro?',
      inviteSuccess: 'Invitación enviada correctamente',
      removeSuccess: 'Miembro eliminado correctamente',
      userNotFound: 'Usuario no encontrado. Debe registrarse primero.',
      maxMembers: 'Se alcanzó el límite de miembros',
      cannotRemoveOwner: 'No puedes eliminar al propietario',
      onlyOwnerCanManage: 'Solo el propietario puede gestionar miembros',
      noTeam: 'No tienes un equipo configurado',
      back: 'Volver a Configuración'
    },
    en: {
      title: 'Team Management',
      subtitle: 'Manage your team members',
      members: 'Team Members',
      inviteMember: 'Invite Member',
      emailPlaceholder: 'email@example.com',
      invite: 'Invite',
      inviting: 'Inviting...',
      remove: 'Remove',
      owner: 'Owner',
      admin: 'Admin',
      member: 'Member',
      you: '(You)',
      confirmRemove: 'Remove this member?',
      inviteSuccess: 'Invitation sent successfully',
      removeSuccess: 'Member removed successfully',
      userNotFound: 'User not found. They must register first.',
      maxMembers: 'Team member limit reached',
      cannotRemoveOwner: 'Cannot remove the owner',
      onlyOwnerCanManage: 'Only the owner can manage members',
      noTeam: 'You don\'t have a team configured',
      back: 'Back to Settings'
    }
  }[language]

  useEffect(() => {
    loadTeamData()
  }, [user])

  async function loadTeamData() {
    if (!user) return
    setLoading(true)
    try {
      const teamData = await getTeam(user.id)
      setTeam(teamData)
      if (teamData) {
        const membersData = await getTeamMembers(teamData.id)
        setMembers(membersData)
      }
    } catch (error) {
      console.error('Failed to load team:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!team || !inviteEmail.trim() || inviting) return
    
    setInviting(true)
    setMessage(null)

    try {
      await inviteTeamMember(team.id, inviteEmail.trim())
      setMessage({ type: 'success', text: t.inviteSuccess })
      setInviteEmail('')
      await loadTeamData()
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to invite'
      if (errorMsg.includes('not found')) {
        setMessage({ type: 'error', text: t.userNotFound })
      } else if (errorMsg.includes('maximum')) {
        setMessage({ type: 'error', text: t.maxMembers })
      } else {
        setMessage({ type: 'error', text: errorMsg })
      }
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(memberId: string, memberUserId: string, role: string) {
    if (!team || removing) return
    
    if (role === 'owner') {
      setMessage({ type: 'error', text: t.cannotRemoveOwner })
      return
    }

    if (!confirm(t.confirmRemove)) return

    setRemoving(memberId)
    setMessage(null)

    try {
      await removeTeamMember(team.id, memberUserId)
      setMessage({ type: 'success', text: t.removeSuccess })
      setMembers(prev => prev.filter(m => m.id !== memberId))
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to remove' })
    } finally {
      setRemoving(null)
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-4 h-4 text-amber-500" />
      case 'admin': return <Shield className="w-4 h-4 text-blue-500" />
      default: return <User className="w-4 h-4 text-dark-400" />
    }
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner': return t.owner
      case 'admin': return t.admin
      default: return t.member
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </Layout>
    )
  }

  if (!team) {
    return (
      <Layout>
        <div className="p-6 lg:p-8 max-w-2xl mx-auto">
          <div className="card text-center py-8">
            <Users className="w-12 h-12 text-dark-300 mx-auto mb-4" />
            <p className="text-dark-600">{t.noTeam}</p>
            <Link to="/settings" className="btn-secondary mt-4 inline-flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              {t.back}
            </Link>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        <div className="mb-6">
          <Link to="/settings" className="text-dark-500 hover:text-dark-700 text-sm flex items-center gap-1 mb-2">
            <ArrowLeft className="w-4 h-4" />
            {t.back}
          </Link>
          <h1 className="text-2xl font-bold text-dark-900 flex items-center gap-3">
            <Users className="w-7 h-7 text-primary-500" />
            {t.title}
          </h1>
          <p className="text-dark-500 mt-1">{t.subtitle}</p>
        </div>

        {message && (
          <div className={`mb-6 flex items-center gap-2 p-3 rounded-lg text-sm ${
            message.type === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            {message.text}
          </div>
        )}

        {/* Invite Member */}
        {isOwner && (
          <div className="card mb-6">
            <h2 className="text-lg font-semibold text-dark-900 mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-green-500" />
              {t.inviteMember}
            </h2>
            <form onSubmit={handleInvite} className="flex gap-3">
              <div className="flex-1 relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  className="input-field pl-10 w-full"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="btn-primary flex items-center gap-2 px-6"
              >
                {inviting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.inviting}
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    {t.invite}
                  </>
                )}
              </button>
            </form>
            <p className="text-xs text-dark-400 mt-2">
              {language === 'es' 
                ? 'El usuario debe estar registrado. Puede registrarse con Google o correo electrónico.'
                : 'User must be registered. They can sign up with Google or email.'}
            </p>
          </div>
        )}

        {/* Team Members List */}
        <div className="card">
          <h2 className="text-lg font-semibold text-dark-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-500" />
            {t.members} ({members.length}/{team.max_members})
          </h2>
          <div className="space-y-3">
            {members.map(member => (
              <div 
                key={member.id} 
                className="flex items-center justify-between p-3 bg-dark-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                    {member.profile?.avatar_url ? (
                      <img 
                        src={member.profile.avatar_url} 
                        alt="" 
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <User className="w-5 h-5 text-primary-600" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-dark-900">
                      {member.profile?.full_name || member.profile?.email?.split('@')[0] || 'User'}
                      {member.user_id === user?.id && (
                        <span className="text-dark-400 text-sm ml-1">{t.you}</span>
                      )}
                    </p>
                    <p className="text-sm text-dark-500">{member.profile?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-sm text-dark-600">
                    {getRoleIcon(member.role)}
                    {getRoleLabel(member.role)}
                  </span>
                  {isOwner && member.role !== 'owner' && (
                    <button
                      onClick={() => handleRemove(member.id, member.user_id, member.role)}
                      disabled={removing === member.id}
                      className="p-2 text-dark-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title={t.remove}
                    >
                      {removing === member.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}
