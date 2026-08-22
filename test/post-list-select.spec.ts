import { describe, expect, it } from 'vitest'
import { POST_LIST_SELECT } from '../src/services/database'

describe('POST_LIST_SELECT', () => {
  it('lists only columns needed by PostWorkspace pagination', () => {
    const cols = POST_LIST_SELECT.split(',')
    expect(cols).toContain('id')
    expect(cols).toContain('generated_image_url')
    expect(cols).toContain('carousel_group_id')
    expect(cols).not.toContain('input_images')
    expect(cols).not.toContain('*')
  })
})
