export default function handler(req, res) {
  const bodyType = Buffer.isBuffer(req.body) ? 'buffer' : typeof req.body
  const payload = {
    method: req.method,
    query: req.query,
    cookies: req.cookies,
    bodyType,
  }
  if (!Buffer.isBuffer(req.body)) payload.body = req.body
  if (Buffer.isBuffer(req.body)) payload.bodyLength = req.body.length
  res.status(200).json(payload)
}
