import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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

    // Use pdf-parse or call external API to extract text
    // For now, we'll use the Grok API to process the PDF content
    const base64Pdf = pdfBuffer.toString('base64')
    
    // Call Grok API to extract text from PDF
    const apiKey = process.env.XAI_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-2-vision-latest',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract ALL text from this PDF menu. Include every dish name, description, and price. Format it clearly with dish names, descriptions, and prices. Do not summarize - include everything verbatim.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64Pdf}`
                }
              }
            ]
          }
        ],
        max_tokens: 4000
      })
    })

    if (!response.ok) {
      // Fallback: Return a message asking user to paste text manually
      console.error('Grok API error:', await response.text())
      return res.status(200).json({ 
        text: '',
        error: 'Could not process PDF automatically. Please paste the menu text manually.',
        needsManualInput: true
      })
    }

    const data = await response.json()
    const extractedText = data.choices?.[0]?.message?.content || ''

    return res.status(200).json({
      text: extractedText,
      url: '' // Could store in Supabase Storage if needed
    })

  } catch (error) {
    console.error('PDF parsing error:', error)
    return res.status(500).json({ 
      error: 'Failed to process PDF',
      text: '',
      needsManualInput: true
    })
  }
}
