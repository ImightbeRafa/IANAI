import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { logApiUsage } from './lib/usage-logger.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

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
    // Parse multipart form data
    const chunks: Buffer[] = []
    
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve())
      req.on('error', reject)
    })

    const buffer = Buffer.concat(chunks)
    
    // Extract PDF content boundary
    const contentType = req.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=(.+)/)
    
    if (!boundaryMatch) {
      return res.status(400).json({ error: 'Invalid multipart form data' })
    }

    const boundary = boundaryMatch[1]
    const parts = buffer.toString('binary').split(`--${boundary}`)
    
    // Find the file part
    let pdfBuffer: Buffer | null = null
    
    for (const part of parts) {
      if (part.includes('filename=') && part.includes('application/pdf')) {
        // Extract the binary content after the headers
        const headerEndIndex = part.indexOf('\r\n\r\n')
        if (headerEndIndex !== -1) {
          const binaryContent = part.slice(headerEndIndex + 4)
          // Remove trailing boundary markers
          const cleanContent = binaryContent.replace(/\r\n--.*$/, '')
          pdfBuffer = Buffer.from(cleanContent, 'binary')
        }
      }
    }

    if (!pdfBuffer) {
      return res.status(400).json({ error: 'No PDF file found in request' })
    }

    // Extract text using pdf-parse (same approach as extract-pdf.ts)
    let textContent = ''

    try {
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
    }

    // Clean up whitespace
    textContent = textContent.replace(/\s+/g, ' ').trim()

    // If extraction returned very little text, it's likely a scanned/image PDF
    if (textContent.length < 50) {
      await logApiUsage({
        userId: user.id,
        userEmail: user.email || undefined,
        feature: 'pdf_extract',
        model: 'pdf-parse',
        success: false,
        errorMessage: 'Insufficient text extracted (likely scanned PDF)',
        metadata: { pdfSizeBytes: pdfBuffer.length, textLength: textContent.length }
      })

      return res.status(200).json({
        text: '',
        error: 'Could not extract text from this PDF. It may be a scanned document. Please paste the menu text manually.',
        needsManualInput: true
      })
    }

    // Limit content length
    const maxLength = 8000
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '...[truncated]'
    }

    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'pdf_extract',
      model: 'pdf-parse',
      success: true,
      metadata: { pdfSizeBytes: pdfBuffer.length, textLength: textContent.length }
    })

    return res.status(200).json({
      text: textContent,
      url: ''
    })

  } catch (error) {
    console.error('PDF parsing error:', error)

    await logApiUsage({
      userId: user.id,
      userEmail: user.email || undefined,
      feature: 'pdf_extract',
      model: 'pdf-parse',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    })

    return res.status(500).json({ 
      error: 'Failed to process PDF',
      text: '',
      needsManualInput: true
    })
  }
}
