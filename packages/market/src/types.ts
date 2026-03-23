/**
 * Markets supported in Phase 2.
 * Phase 3 will extend this union (e.g. PH, VN, AU).
 */
export type Market = 'SG' | 'MY' | 'TH' | 'ID' | 'UK' | 'DE'

/**
 * Regulatory / certification bodies by market.
 * Each body is only valid in its respective market (see compliance-rules.ts).
 */
export type CertificationBody =
  | 'IMDA'  // Singapore – Infocomm Media Development Authority (electronics, telecom)
  | 'SFA'   // Singapore – Singapore Food Agency (food, supplements)
  | 'HSA'   // Singapore – Health Sciences Authority (medical devices)
  | 'SIRIM' // Malaysia – SIRIM Berhad (electronics, electrical)
  | 'MOH'   // Malaysia – Ministry of Health (supplements)
  | 'FDA'   // Thailand – Food and Drug Administration (food, cosmetics)
  | 'BPOM'  // Indonesia – Badan Pengawas Obat dan Makanan (food, cosmetics, medical)
  | 'UKCA'  // UK – UK Conformity Assessed (replaces CE post-Brexit)
  | 'WEEE'  // EU/UK – Waste Electrical and Electronic Equipment directive

export interface ExchangeRate {
  from: string
  to: string
  rate: number
  fetchedAt: Date
}

export interface TaxRate {
  market: Market
  /** Decimal fraction, e.g. 0.09 for 9% GST. */
  rate: number
  /** Human-readable tax name: 'GST' | 'SST' | 'VAT' | 'PPN' | 'MwSt' */
  name: string
  /**
   * Whether the platform price is tax-inclusive.
   * TH and ID prices include VAT/PPN; SG, MY, UK, DE prices are pre-tax.
   */
  inclusive: boolean
}

export interface TaxCalculationResult {
  baseAmount: number
  taxAmount: number
  totalAmount: number
  taxRate: TaxRate
}

export interface ProductComplianceInfo {
  /** Platform taxonomy category slug (kebab-case English). */
  category: string
  subcategory?: string
  hasElectronics: boolean
  hasFood: boolean
  hasCosme: boolean
  market: Market
}

export interface ComplianceResult {
  compliant: boolean
  issues: string[]
  requiredCertifications: CertificationBody[]
  warnings: string[]
}
