import { waitUntil } from '@vercel/functions'

export default function handler(req, res) {
  Promise.reject(new Error('floating'))
  waitUntil(Promise.reject(new Error('bg-fail')))
  res.status(200).json({ ok: true })
}
