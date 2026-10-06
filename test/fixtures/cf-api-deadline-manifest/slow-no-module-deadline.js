// Deliberately NO `export const maxDuration` here — the point of this
// fixture is to prove the deadline comes from the injected
// _route-deadlines.json manifest (round-6 operator review, item H's
// trailing-slash normalization), not from a module export.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export default async function handler(req, res) {
  const ms = Number(req.query.ms ?? 0)
  await sleep(ms)
  res.status(200).json({ slept: ms })
}
