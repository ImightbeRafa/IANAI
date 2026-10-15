/**
 * Single source of the MCP server identity. `serverInfo.version` is only visible to clients at `initialize`; the
 * `get_server_info` tool and the `serverVersion` field of every execute result expose the same data inside a tool
 * response (free, read-only, no side effects) so a client can tell which build answered.
 */
export const MCP_VERSION = '0.26.0'

export const MCP_SERVER_INFO = {
  name: 'advance-ai',
  version: MCP_VERSION,
  title: 'Advance AI',
  websiteUrl: 'https://advanceai.studio',
  icons: [{ src: 'https://advanceai.studio/brand/advance-mark.png', mimeType: 'image/png', sizes: ['74x73'] }],
}

/** Capabilities a client can feature-detect (keep in sync with docs/operations/mcp-user-tools.md). */
export const MCP_FEATURES = [
  'generated_web_flow',
  'exact_with_text_logo_qa',
  'fidelity_warning_feature_match',
  'props_policy_input',
  'props_warning',
  'safe_zone_margin_8pct',
  'one_cta_rule',
  'layout_cap_copy_overflow',
  'auto_retry_keep_better',
  'provider_retry_backoff',
  'halo_warning',
  'server_version_in_results',
  'safe_zone_autofix',
  'props_unlisted_object_check',
  'accessory_refs_budget_5',
  'caption_field',
  'fidelity_palette_fallback',
  'seam_blend_no_letterbox',
  'text_never_over_product_make_room',
  'product_notes_input',
  'exact_uses_code_layout',
  'scale_in_never_with_composite',
  'seam_blend_refuses_detailed_content',
  'generic_product_lock',
  'claims_filter_removed_claims',
  'logo_icon_warning',
  'strips_crop_and_zoom',
  'cta_never_over_product_room_below',
  'cta_count_from_compositor_only',
  'scene_edges_not_fail_triggers',
  'fidelity_view_change_tolerant_for_box_photos',
  'logo_scrim_below_4_5',
  'shipping_line_kept_when_room',
  'cta_never_dropped',
  'lock_scoped_to_photo_role',
  'props_thin_cable_and_main_product_check',
  'logo_trim_aspect_solid_plate_wordmark_first',
  'raw_scene_saved',
  'continuation_no_mirror',
  'shrink_picture_before_text',
  'cta_clean_slot_only',
  'wood_grain_not_prop',
  'text_never_over_any_object',
  'cutout_mask_coverage_repair',
  'fidelity_vs_reference_photo',
  'clear_sheet_film_kept',
  'self_plated_logo_no_second_plate',
  'cross_offer_asset_reuse',
  'pack_ocr_small_print_tiles',
  'mask_repair_connected_only_leftover_fail',
  'cta_blocked_shrinks_picture_to_60',
  'cutout_meta_survives_cache',
  'film_without_backdrop_veil',
  'bundle_offer_line_kept',
  'framed_badge_logo_self_plated',
  // 0.26.0 (docs/mcp-quality.md)
  'model_designed_ad_default',
  'composite_layers_opt_in',
  'confirmed_refs_only_no_kit_union',
  'pack_real_pixel_swap',
  'auto_retry_max_one_opt_in',
  'paid_calls_logged_per_call',
  'stamp_logo_price_opt_in',
  'fidelity_warning_only',
] as const

declare const __ADVANCE_BUILD_COMMIT__: string | undefined

function buildCommit(env: Record<string, string | undefined>): string {
  const injected = typeof __ADVANCE_BUILD_COMMIT__ !== 'undefined' ? __ADVANCE_BUILD_COMMIT__ : ''
  return (env.BUILD_COMMIT || env.GIT_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || injected || '').trim().slice(0, 40) || 'unknown'
}

export function buildServerInfo(opts: { commit?: string; env?: Record<string, string | undefined> } = {}): {
  name: string
  version: string
  commit: string
  features: readonly string[]
} {
  const env = opts.env ?? (typeof process !== 'undefined' ? process.env : {})
  return { name: MCP_SERVER_INFO.name, version: MCP_VERSION, commit: opts.commit || buildCommit(env), features: MCP_FEATURES }
}
