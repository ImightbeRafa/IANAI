export declare const HTML_NO_CACHE: string
export declare const CF_CONTENT_SECURITY_POLICY: string
export declare const REMOVED_CSP_SOURCES: readonly string[]
export declare const SECURITY_HEADERS: readonly (readonly [string, string])[]
export declare function isHtmlEntryPath(p: string): boolean
export declare function rewriteToApi(p: string): string | null
export declare function isApiPath(p: string): boolean
export declare function isContainerPath(p: string): boolean
export declare function isSpaFallbackPath(p: string): boolean
export declare function parseSizeLimit(v: number | string): number
