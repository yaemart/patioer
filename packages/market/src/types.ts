/**
 * Markets supported by the system.
 * Phase 2: SG, MY, TH, ID, UK, DE (Shopee/TikTok/Amazon SEA + EU).
 * Walmart integration: US, CA, MX.
 */
export type Market = 'SG' | 'MY' | 'TH' | 'ID' | 'UK' | 'DE' | 'US' | 'CA' | 'MX'

/**
 * Regulatory / certification bodies by market.
 * Each body is only valid in its respective market (see compliance-rules.ts).
 */
export type CertificationBody =
  | 'IMDA'      // Singapore – Infocomm Media Development Authority (electronics, telecom)
  | 'SFA'       // Singapore – Singapore Food Agency (food, supplements)
  | 'HSA'       // Singapore – Health Sciences Authority (medical devices)
  | 'SIRIM'     // Malaysia – SIRIM Berhad (electronics, electrical)
  | 'MOH'       // Malaysia – Ministry of Health (supplements)
  | 'FDA'       // Thailand – Food and Drug Administration (food, cosmetics)
  | 'BPOM'      // Indonesia – Badan Pengawas Obat dan Makanan (food, cosmetics, medical)
  | 'UKCA'      // UK – UK Conformity Assessed (replaces CE post-Brexit)
  | 'WEEE'      // EU/UK – Waste Electrical and Electronic Equipment directive
  | 'FDA_US'    // US – Food and Drug Administration (food, drugs, medical devices, cosmetics)
  | 'FCC'       // US – Federal Communications Commission (electronics, RF devices)
  | 'CPSC'      // US – Consumer Product Safety Commission (consumer products, children's items)
  | 'HC'        // Canada – Health Canada (food, drugs, natural health products)
  | 'ISED'      // Canada – Innovation, Science and Economic Development (radio, electronics)
  | 'COFEPRIS'  // Mexico – Comisión Federal para la Protección contra Riesgos Sanitarios

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
