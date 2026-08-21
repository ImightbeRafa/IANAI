import { describe, expect, it } from 'vitest'
import {
  buildImageWorkspaces,
  isImageWorkspaceAnchor,
  latestGeneratedPerWorkspace,
  sourceProductImageId,
} from '../src/features/chat-shell/chatShellImages'

function img(partial: {
  id: string
  product_id?: string
  message_id?: string | null
  created_at: string
  kind?: 'generated' | 'product'
}) {
  return {
    id: partial.id,
    product_id: partial.product_id || 'offer-a',
    kind: partial.kind || 'generated' as const,
    image_url: `https://cdn.example/${partial.id}.webp`,
    created_at: partial.created_at,
    message_id: partial.message_id,
    label: partial.id,
  }
}

describe('buildImageWorkspaces', () => {
  it('keeps independent generates of the same offer in separate workspaces', () => {
    const workspaces = buildImageWorkspaces([
      img({ id: 'gen-1', message_id: 'msg-1', created_at: '2026-01-01T00:00:00.000Z' }),
      img({ id: 'gen-2', message_id: 'msg-2', created_at: '2026-01-02T00:00:00.000Z' }),
    ])
    expect(workspaces).toHaveLength(2)
    expect(workspaces.map((workspace) => workspace.rootImageId).sort()).toEqual(['gen-1', 'gen-2'])
  })

  it('joins edits/enhances to the parent generate via source_product_image_id even across old messages', () => {
    const workspaces = buildImageWorkspaces(
      [
        img({ id: 'gen-1', message_id: 'msg-1', created_at: '2026-01-01T00:00:00.000Z' }),
        img({ id: 'edit-1', message_id: 'msg-2', created_at: '2026-01-02T00:00:00.000Z' }),
        img({ id: 'gen-2', message_id: 'msg-3', created_at: '2026-01-03T00:00:00.000Z' }),
      ],
      [
        {
          artifact_type: 'image',
          product_image_id: 'edit-1',
          action_type: 'enhance',
          action_metadata: { source_product_image_id: 'gen-1' },
          message_id: 'msg-2',
        },
      ]
    )
    expect(workspaces).toHaveLength(2)
    const first = workspaces.find((workspace) => workspace.rootImageId === 'gen-1')
    expect(first?.versions.map((version) => version.id)).toEqual(['gen-1', 'edit-1'])
    expect(isImageWorkspaceAnchor('gen-1', workspaces)).toBe(true)
    expect(isImageWorkspaceAnchor('edit-1', workspaces)).toBe(false)
    expect(isImageWorkspaceAnchor('gen-2', workspaces)).toBe(true)
  })

  it('treats generated images that share a message as one workspace, oldest first', () => {
    const workspaces = buildImageWorkspaces([
      img({ id: 'gen-1', message_id: 'msg-1', created_at: '2026-01-01T00:00:00.000Z' }),
      img({ id: 'edit-1', message_id: 'msg-1', created_at: '2026-01-02T00:00:00.000Z' }),
      img({ id: 'edit-2', message_id: 'msg-1', created_at: '2026-01-03T00:00:00.000Z' }),
    ])
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].versions.map((version) => version.id)).toEqual(['gen-1', 'edit-1', 'edit-2'])
    expect(latestGeneratedPerWorkspace(workspaces).map((image) => image.id)).toEqual(['edit-2'])
  })

  it('ignores missing parents and does not loop on cycles', () => {
    expect(sourceProductImageId({ source_product_image_id: '  ' })).toBeNull()
    const workspaces = buildImageWorkspaces(
      [
        img({ id: 'a', message_id: 'msg-a', created_at: '2026-01-01T00:00:00.000Z' }),
        img({ id: 'b', message_id: 'msg-b', created_at: '2026-01-02T00:00:00.000Z' }),
      ],
      [
        {
          artifact_type: 'image',
          product_image_id: 'a',
          action_metadata: { source_product_image_id: 'b' },
        },
        {
          artifact_type: 'image',
          product_image_id: 'b',
          action_metadata: { source_product_image_id: 'a' },
        },
        {
          artifact_type: 'image',
          product_image_id: 'orphan',
          action_metadata: { source_product_image_id: 'missing' },
        },
      ]
    )
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].versions.map((version) => version.id).sort()).toEqual(['a', 'b'])
  })
})
