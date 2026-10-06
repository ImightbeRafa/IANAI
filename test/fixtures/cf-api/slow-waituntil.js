// Deliberately short deadline (100ms) so the request itself times out
// quickly, independent of the background job: this handler never calls
// res.end at all, relying purely on the adapter's deadline timeout, while
// a waitUntil job keeps running (and must still finish) after that.
import { waitUntil } from '@vercel/functions'
import { state } from './_bg-state.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export const maxDuration = 0.1

export default function handler(req, res) {
  const id = req.query.id
  const ms = Number(req.query.ms ?? 300)
  state.set(id, 'pending')
  waitUntil(sleep(ms).then(() => state.set(id, 'done')))
  // No response — the deadline timer is the only thing that ever answers this request.
}
