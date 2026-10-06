import { state } from './_bg-state.js'

// Mirrors the real wiring in api/chat.ts etc.: read the deadline signal via
// the same magic property api/lib/request-deadline.ts's getDeadlineSignal
// reads (req.__cfDeadlineSignal) — a fixture can't import the compiled
// dist-api version, so it reads the raw property directly instead, same
// shape as the real helper.
export const maxDuration = 0.1

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export default async function handler(req, res) {
  const id = req.query.id
  const ms = Number(req.query.ms ?? 300)
  await sleep(ms)
  const signal = req.__cfDeadlineSignal
  if (signal?.aborted) {
    state.set(id, 'charge-skipped')
    return // no charge, no write — the client already got its 504
  }
  state.set(id, 'charged')
  res.status(200).json({ charged: true })
}
