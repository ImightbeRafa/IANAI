export default function handler(req, res) {
  const bodyType = Buffer.isBuffer(req.body) ? 'buffer' : typeof req.body
  res.status(200).json({ bodyType, length: req.body?.length ?? null })
}
