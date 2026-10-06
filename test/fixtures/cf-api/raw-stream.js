import { createHash } from 'node:crypto'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
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
