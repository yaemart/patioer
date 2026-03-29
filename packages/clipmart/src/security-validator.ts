export interface ValidationResult {
  valid: boolean
  errors: SecurityViolation[]
  sanitizedConfig: Record<string, unknown> | null
}

export interface SecurityViolation {
  rule: SecurityRule
  path: string
  message: string
}

export type SecurityRule =
  | 'constitution_protection'
  | 'field_whitelist'
  | 'depth_limit'
  | 'sensitive_field'
  | 'cross_tenant'

const MAX_DEPTH = 10

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'agents',
  'governance',
  'dataosTier',
])

const SENSITIVE_KEYS = new Set([
  'apikeys',
  'apikey',
  'tokens',
  'token',
  'credentials',
  'secret',
  'secrets',
  'password',
  'passwords',
  'private_key',
  'privatekey',
])

const CONSTITUTION_PATTERNS = [
  /system[\s_-]*constitution/i,
  /modify[\s_-]*constitution/i,
  /override[\s_-]*constitution/i,
  /delete[\s_-]*constitution/i,
  /replace[\s_-]*constitution/i,
  /ignore[\s_-]*constitution/i,
  /bypass[\s_-]*constitution/i,
  /disable[\s_-]*constitution/i,
]

export function validateTemplateConfig(config: unknown): ValidationResult {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return {
      valid: false,
      errors: [{
        rule: 'field_whitelist',
        path: '$',
        message: 'Template config must be a non-null object',
      }],
      sanitizedConfig: null,
    }
  }

  const errors: SecurityViolation[] = []
  const raw = config as Record<string, unknown>

  checkTopLevelFields(raw, errors)
  checkConstitutionProtection(raw, '$', errors)
  checkDepthLimit(raw, '$', 0, errors)
  const sanitized = stripSensitiveFields(raw, '$', errors)
  checkCrossTenant(sanitized, '$', errors)

  const hasBlockingErrors = errors.some((e) => e.rule !== 'sensitive_field')

  return {
    valid: !hasBlockingErrors,
    errors,
    sanitizedConfig: hasBlockingErrors ? null : sanitized as Record<string, unknown>,
  }
}

function checkTopLevelFields(obj: Record<string, unknown>, errors: SecurityViolation[]): void {
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push({
        rule: 'field_whitelist',
        path: `$.${key}`,
        message: `Disallowed top-level field: "${key}". Allowed: ${[...ALLOWED_TOP_LEVEL_KEYS].join(', ')}`,
      })
    }
  }
}

function checkConstitutionProtection(
  value: unknown,
  path: string,
  errors: SecurityViolation[],
): void {
  if (typeof value === 'string') {
    for (const pattern of CONSTITUTION_PATTERNS) {
      if (pattern.test(value)) {
        errors.push({
          rule: 'constitution_protection',
          path,
          message: `Template must not contain instructions to modify System Constitution: "${value.slice(0, 100)}"`,
        })
        return
      }
    }
    return
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkConstitutionProtection(value[i], `${path}[${i}]`, errors)
    }
    return
  }

  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      checkConstitutionProtection(v, `${path}.${k}`, errors)
    }
  }
}

function checkDepthLimit(
  value: unknown,
  path: string,
  currentDepth: number,
  errors: SecurityViolation[],
): void {
  if (currentDepth > MAX_DEPTH) {
    errors.push({
      rule: 'depth_limit',
      path,
      message: `JSON nesting exceeds maximum depth of ${MAX_DEPTH}`,
    })
    return
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkDepthLimit(value[i], `${path}[${i}]`, currentDepth + 1, errors)
    }
    return
  }

  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      checkDepthLimit(v, `${path}.${k}`, currentDepth + 1, errors)
    }
  }
}

function stripSensitiveFields(
  value: unknown,
  path: string,
  errors: SecurityViolation[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      stripSensitiveFields(item, `${path}[${i}]`, errors),
    )
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        errors.push({
          rule: 'sensitive_field',
          path: `${path}.${k}`,
          message: `Sensitive field "${k}" automatically removed`,
        })
        continue
      }
      result[k] = stripSensitiveFields(v, `${path}.${k}`, errors)
    }
    return result
  }

  return value
}

function checkCrossTenant(
  value: unknown,
  path: string,
  errors: SecurityViolation[],
): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ('tenantId' in obj || 'tenant_id' in obj) {
      const field = 'tenantId' in obj ? 'tenantId' : 'tenant_id'
      errors.push({
        rule: 'cross_tenant',
        path: `${path}.${field}`,
        message: 'Templates must not contain tenantId — it is overwritten during import',
      })
    }
    for (const [k, v] of Object.entries(obj)) {
      checkCrossTenant(v, `${path}.${k}`, errors)
    }
    return
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkCrossTenant(value[i], `${path}[${i}]`, errors)
    }
  }
}
