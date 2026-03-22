import { z } from 'zod'
import { SUPPORTED_PLATFORMS } from './supported-platforms.js'

/** Zod schema for API / job payloads (matches `SupportedPlatform`). */
export const platformZod = z.enum(SUPPORTED_PLATFORMS)

/** Optional platform field (e.g. PATCH `/approvals/.../resolve`, `approval.execute` job). */
export const optionalPlatformZod = platformZod.optional()
