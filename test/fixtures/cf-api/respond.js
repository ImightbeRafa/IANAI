export default function handler(req, res) {
  const mode = req.query.mode
  switch (mode) {
    case 'send-string':
      res.send('hello')
      return
    case 'send-buffer':
      res.send(Buffer.from([1, 2, 3]))
      return
    case 'send-object':
      res.send({ a: 1 })
      return
    case 'status-json':
      res.status(201).json({ created: true })
      return
    case 'redirect':
      res.redirect('/login')
      return
    case 'redirect-301':
      res.redirect(301, 'https://example.test/x')
      return
    case 'end-204':
      res.status(204).end()
      return
    default:
      res.status(400).json({ error: 'unknown mode' })
  }
}
