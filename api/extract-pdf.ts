import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { logApiUsage } from './lib/usage-logger.js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify authentication
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' })
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  try {
    const { base64Content, fileName } = req.body

    if (!base64Content || typeof base64Content !== 'string') {
      return res.status(400).json({ error: 'PDF content is required' })
    }

    // Decode base64 to buffer
    const pdfBuffer = Buffer.from(base64Content, 'base64')
    
    // Extract text from PDF using pdf-parse compatible approach
    // For serverless, we use a simple text extraction
    let textContent = ''
    
    try {
      // Try to extract text using pdf-parse if available
      const pdfParse = await import('pdf-parse')
      const pdfData = await pdfParse.default(pdfBuffer)
      textContent = pdfData.text
    } catch {
      // Fallback: Basic text extraction for PDFs with embedded text
      const pdfString = pdfBuffer.toString('utf8')
      const textMatches = pdfString.match(/\(([^)]+)\)/g) || []
      textContent = textMatches
        .map(m => m.slice(1, -1))
        .filter(t => t.length > 1 && !/^[\\\/\d\s]+$/.test(t))
        .join(' ')
      
      if (textContent.length < 50) {
        textContent = 'PDF uploaded: ' + (fileName || 'document.pdf') + '\n[Note: Text extraction limited. PDF may contain images or scanned content.]'
      }
    }

    // Clean up the text
    textContent = textContent
      .replace(/\s+/g, ' ')
      .trim()

    // Limit content length
    const maxLength = 8000
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '...[truncated]'
    }

    // Log usage - PDF extraction is tracked as a utility feature
    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'pdf_extract',
      model: 'pdf-parse',
      success: true,
      metadata: { 
        fileName: fileName || 'document.pdf',
        contentLength: textContent.length,
        fileSize: base64Content.length
      }
    })

    return res.status(200).json({
      success: true,
      content: textContent,
      fileName: fileName || 'document.pdf',
      pageCount: 'unknown'
    })

  } catch (error) {
    console.error('PDF extraction error:', error)
    
    // Log failed usage
    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'pdf_extract',
      model: 'pdf-parse',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })
    
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to extract PDF content'
    })
  }
}
