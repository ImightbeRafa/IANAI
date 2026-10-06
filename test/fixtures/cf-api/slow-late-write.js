import { state } from './_bg-state.js'

// Short deadline (100ms) so the adapter's own 504 fires well before this
// handler finishes sleeping. The handler then deliberately tries to write a
// real response AFTER that — proving the write is a safe no-op (not a
// crash) and that the handler's own code after the write still runs.
export const maxDuration = 0.1

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export default async function handler(req, res) {
  const id = req.query.id
  await sleep(300)
  res.status(200).json({ late: true }) // must no-op safely — the 504 already went out
  state.set(id, 'post-write-ran') // proves execution continued past the blocked write
}
