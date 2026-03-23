import type { Market, ProductComplianceInfo, ComplianceResult, CertificationBody } from './types.js'
import { PROHIBITED_CATEGORIES, CERTIFICATION_REQUIREMENTS } from './compliance-rules.js'

/**
 * Returns true if the category slug is prohibited in the given market.
 *
 * Matching rules (all comparisons are lowercased):
 *   - Exact: 'controlled-drugs' matches 'controlled-drugs'
 *   - Prefix: 'controlled-drugs' matches 'controlled-drugs-opioids'
 *
 * This lets a single rule cover an entire sub-tree of categories.
 */
export function isProhibited(category: string, market: Market): boolean {
  const normalised = category.toLowerCase()
  return PROHIBITED_CATEGORIES[market].some(
    (p) => normalised === p || normalised.startsWith(p + '-'),
  )
}

/**
 * Return the certification bodies required for a category in the given market.
 * Returns an empty array when no tracked requirements exist.
 *
 * Matching uses the same exact + prefix logic as isProhibited so that
 * 'electronics' covers 'electronics-appliances', 'electronics-wearables', etc.
 */
export function getRequiredCertifications(
  category: string,
  market: Market,
): CertificationBody[] {
  const requirements = CERTIFICATION_REQUIREMENTS[market]
  const normalised = category.toLowerCase()
  for (const [key, certs] of Object.entries(requirements)) {
    if (normalised === key || normalised.startsWith(key + '-')) {
      return certs
    }
  }
  return []
}

/**
 * Run a full compliance check for a product in a given market.
 *
 * Returns:
 *   - `compliant: false` + non-empty `issues` when the category is prohibited
 *     → Agent must open a human-approval Ticket before listing.
 *   - `requiredCertifications` for the category and any cross-cutting flags
 *     (hasElectronics / hasCosme).
 *   - `warnings` for food-related products that need manual registration check
 *     → Agent logs to Audit Log but does not block listing.
 *
 * Certifications are deduplicated; the same body will not appear twice.
 */
export function checkCompliance(info: ProductComplianceInfo): ComplianceResult {
  const issues: string[] = []
  const warnings: string[] = []
  const requiredCertifications: CertificationBody[] = []

  const { category, market, hasElectronics, hasFood, hasCosme } = info

  // 1. Prohibited-category gate
  if (isProhibited(category, market)) {
    issues.push(`Category "${category}" is prohibited in market ${market}`)
  }

  // 2. Primary category certifications
  for (const cert of getRequiredCertifications(category, market)) {
    if (!requiredCertifications.includes(cert)) requiredCertifications.push(cert)
  }

  // 3. Cross-cutting flags
  if (hasElectronics) {
    for (const cert of getRequiredCertifications('electronics', market)) {
      if (!requiredCertifications.includes(cert)) requiredCertifications.push(cert)
    }
  }

  if (hasFood) {
    warnings.push(`Food-related product in ${market}: verify SFA/BPOM/FDA registration`)
  }

  if (hasCosme) {
    for (const cert of getRequiredCertifications('cosmetics', market)) {
      if (!requiredCertifications.includes(cert)) requiredCertifications.push(cert)
    }
  }

  return {
    compliant: issues.length === 0,
    issues,
    requiredCertifications,
    warnings,
  }
}
