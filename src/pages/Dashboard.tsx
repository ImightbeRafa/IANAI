import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getDashboardStats, getConversations } from '../services/database'
import type { DashboardStats, Conversation } from '../types'
import Layout from '../components/Layout'
import { 
  MessageSquare, 
  FileText, 
  TrendingUp, 
  Clock,
  Plus,
  ArrowRight
} from 'lucide-react'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      if (!user) return
      try {
        const [statsData, conversationsData] = await Promise.all([
          getDashboardStats(user.id),
          getConversations(user.id)
        ])
        setStats(statsData)
        setRecentConversations(conversationsData.slice(0, 5))
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user])

  const statCards = [
    { label: 'Total Conversations', value: stats?.totalConversations || 0, icon: MessageSquare, color: 'bg-blue-500' },
    { label: 'Total Scripts', value: stats?.totalScripts || 0, icon: FileText, color: 'bg-green-500' },
    { label: 'Active Sessions', value: stats?.activeConversations || 0, icon: TrendingUp, color: 'bg-purple-500' },
    { label: 'Scripts This Month', value: stats?.scriptsThisMonth || 0, icon: Clock, color: 'bg-orange-500' },
  ]

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-dark-900">
              Welcome back, {user?.user_metadata?.full_name || 'there'}!
            </h1>
            <p className="text-dark-500 mt-1">Here's an overview of your copywriting activity</p>
          </div>
          <Link to="/chat" className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-5 h-5" />
            New Script
          </Link>
        </div>

        {/* Stats Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-16 bg-dark-100 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="card">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-dark-900">{value}</p>
                    <p className="text-sm text-dark-500">{label}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recent Conversations */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-dark-900">Recent Conversations</h2>
            <Link to="/history" className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-dark-50 rounded-lg animate-pulse"></div>
              ))}
            </div>
          ) : recentConversations.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-12 h-12 text-dark-300 mx-auto mb-4" />
              <p className="text-dark-500 mb-4">No conversations yet</p>
              <Link to="/chat" className="btn-primary inline-flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Start Your First Script
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentConversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  to={`/chat/${conversation.id}`}
                  className="block p-4 bg-dark-50 hover:bg-dark-100 rounded-lg transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-dark-900">{conversation.title}</p>
                      <p className="text-sm text-dark-500">
                        {new Date(conversation.updated_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      conversation.status === 'active' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-dark-200 text-dark-600'
                    }`}>
                      {conversation.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
