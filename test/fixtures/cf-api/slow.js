// Short fixture deadline (300ms) so deadline tests run fast. Sleeps for
// ?ms=<n>, then always calls res.json — even when that happens well after
// the deadline already fired, to prove the adapter's write-after-end guard
// doesn't crash the server.
export const maxDuration = 0.3

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export default async function handler(req, res) {
  const ms = Number(req.query.ms ?? 0)
  await sleep(ms)
  res.status(200).json({ slept: ms })
}
