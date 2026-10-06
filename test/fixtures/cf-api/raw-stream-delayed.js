import { createHash } from 'node:crypto'

export const config = { api: { bodyParser: false } }

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Mirrors api/parse-pdf.ts: an await (e.g. supabase.auth.getUser) happens
// BEFORE the handler ever attaches a listener to the request stream. A
// naive adapter that starts consuming req.on('data') early (switching the
// stream into flowing mode before this point) would lose chunks — or even
// the 'end' event — that arrive during this delay.
export default async function handler(req, res) {
  await sleep(300)

  const hash = createHash('sha256')
  let length = 0
  req.on('data', (chunk) => {
    length += chunk.length
    hash.update(chunk)
  })
  req.on('end', () => {
    res.status(200).json({
      bodyIsUndefined: req.body === undefined,
      length,
      sha256: hash.digest('hex'),
    })
  })
}
