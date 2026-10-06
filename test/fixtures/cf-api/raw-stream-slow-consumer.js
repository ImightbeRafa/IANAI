import { createHash } from 'node:crypto'

export const config = { api: { bodyParser: false } }

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// A deliberately slow consumer: a real pause between reading each chunk via
// async iteration (req[Symbol.asyncIterator], same protocol `for await`
// uses). This is what actually exercises the backpressure path in
// proxyLimitedRawStream — the producer side fills the counting PassThrough
// faster than this loop drains it, so counter.write() returns false
// (repeatedly) long before the body finishes, and pump() must resume
// correctly every time counter drains without ever deadlocking.
export default async function handler(req, res) {
  const hash = createHash('sha256')
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    hash.update(chunk)
    await sleep(5)
  }
  res.status(200).json({
    bodyIsUndefined: req.body === undefined,
    length,
    sha256: hash.digest('hex'),
  })
}
