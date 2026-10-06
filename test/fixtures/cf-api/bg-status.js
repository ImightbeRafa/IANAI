import { state } from './_bg-state.js'

export default function handler(req, res) {
  const id = req.query.id
  res.status(200).json({ id, state: state.get(id) ?? null })
}
