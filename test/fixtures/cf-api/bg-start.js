import { writeFileSync } from 'node:fs'
import { waitUntil } from '@vercel/functions'
import { state } from './_bg-state.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export default function handler(req, res) {
  const id = req.query.id
  const ms = Number(req.query.ms ?? 0)
  const file = req.query.file

  state.set(id, 'pending')
  waitUntil(
    sleep(ms).then(() => {
      state.set(id, 'done')
      if (file) writeFileSync(file, 'done')
    })
  )
  res.status(202).json({ id, state: 'pending' })
}
