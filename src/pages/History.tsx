import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getConversations, deleteConversation, searchConversations } from '../services/database'
import type { Conversation } from '../types'
import Layout from '../components/Layout'
import { Search, MessageSquare, Trash2, Clock, Filter } from 'lucide-react'

export default function History() {
  const { user } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')

  useEffect(() => {
    loadConversations()
  }, [user])

  const loadConversations = async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await getConversations(user.id)
      setConversations(data)
    } catch (error) {
      console.error('Failed to load conversations:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!user) return
    if (!searchQuery.trim()) {
      loadConversations()
      return
    }
    setLoading(true)
    try {
      const data = await searchConversations(user.id, searchQuery)
      setConversations(data)
    } catch (error) {
      console.error('Failed to search:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this conversation? This cannot be undone.')) return
    try {
      await deleteConversation(id)
      setConversations(prev => prev.filter(c => c.id !== id))
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }

  const filteredConversations = conversations.filter(c => {
    if (filter === 'all') return true
    return c.status === filter
  })

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-dark-900">Conversation History</h1>
          <p className="text-dark-500 mt-1">View and manage your past conversations</p>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search conversations..."
              className="input-field pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-dark-400" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | 'active' | 'completed')}
              className="input-field w-auto"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {/* Conversations List */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-20 bg-dark-100 rounded"></div>
              </div>
            ))}
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="card text-center py-12">
            <MessageSquare className="w-12 h-12 text-dark-300 mx-auto mb-4" />
            <p className="text-dark-500 mb-4">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </p>
            <Link to="/chat" className="btn-primary inline-block">
              Start New Conversation
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredConversations.map((conversation) => (
              <div
                key={conversation.id}
                className="card hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <Link
                    to={`/chat/${conversation.id}`}
                    className="flex-1 min-w-0"
                  >
                    <h3 className="font-medium text-dark-900 truncate">
                      {conversation.title}
                    </h3>
                    <div className="flex items-center gap-4 mt-2 text-sm text-dark-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {new Date(conversation.updated_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        conversation.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : conversation.status === 'completed'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-dark-100 text-dark-600'
                      }`}>
                        {conversation.status}
                      </span>
                    </div>
                  </Link>
                  <button
                    onClick={() => handleDelete(conversation.id)}
                    className="p-2 text-dark-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete conversation"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
