/**
 * Multi-market Prohibited Keywords & Compliance Rules (Phase 4 §S12 task 12.1)
 *
 * Constitution §2.3: All product listings go through compliance before publish.
 * Phase 4 重点市场: SG · ID · DE · US
 */

// ─── Market Type ──────────────────────────────────────────────────────────────

export type ComplianceMarket = 'SG' | 'ID' | 'DE' | 'US' | 'CA' | 'MX'

export const ALL_COMPLIANCE_MARKETS: readonly ComplianceMarket[] = ['SG', 'ID', 'DE', 'US', 'CA', 'MX'] as const

// ─── Compliance Check Types ───────────────────────────────────────────────────

export type ComplianceSeverity = 'block' | 'warn' | 'info'

export interface ComplianceViolation {
  market: ComplianceMarket
  checkType: 'prohibited_keyword' | 'category_restriction' | 'certification_missing' | 'hs_code' | 'ai_content'
  severity: ComplianceSeverity
  field: string
  matchedValue: string
  rule: string
  suggestion?: string
}

export interface ComplianceCheckResult {
  passed: boolean
  violations: ComplianceViolation[]
  market: ComplianceMarket
  checkedAt: string
}

export interface ComplianceProductInput {
  productId: string
  title: string
  description: string
  category?: string
  tags?: string[]
  price: number | null
  imageUrls?: string[]
  hsCode?: string
  certifications?: string[]
}

// ─── Prohibited Keywords per Market ───────────────────────────────────────────

export interface ProhibitedKeywordEntry {
  keyword: string
  severity: ComplianceSeverity
  reason: string
}

const SG_KEYWORDS: readonly ProhibitedKeywordEntry[] = [
  { keyword: 'chewing gum', severity: 'block', reason: 'Sale of chewing gum prohibited in Singapore (Regulation of Imports and Exports Act)' },
  { keyword: 'bubble gum', severity: 'block', reason: 'Sale of chewing/bubble gum prohibited in Singapore' },
  { keyword: 'firework', severity: 'block', reason: 'Fireworks prohibited under Arms & Explosives Act' },
  { keyword: 'firecracker', severity: 'block', reason: 'Firecrackers prohibited under Arms & Explosives Act' },
  { keyword: 'unapproved drug', severity: 'block', reason: 'Unapproved drugs prohibited under HSA regulations' },
  { keyword: 'controlled substance', severity: 'block', reason: 'Controlled substances prohibited under Misuse of Drugs Act' },
  { keyword: 'e-cigarette', severity: 'block', reason: 'E-cigarettes and vapes prohibited under Tobacco (Control of Advertisements and Sale) Act' },
  { keyword: 'vape', severity: 'block', reason: 'Vaping devices prohibited in Singapore' },
  { keyword: 'imitation firearm', severity: 'block', reason: 'Imitation firearms prohibited under Arms & Explosives Act' },
  { keyword: 'endangered species', severity: 'block', reason: 'CITES-listed species products prohibited' },
]

const ID_KEYWORDS: readonly ProhibitedKeywordEntry[] = [
  { keyword: 'pork', severity: 'warn', reason: 'Pork products require Halal certification or explicit non-Halal labeling (BPJPH)' },
  { keyword: 'babi', severity: 'warn', reason: 'Pork (babi) products require Halal certification or explicit labeling' },
  { keyword: 'gelatin', severity: 'warn', reason: 'Gelatin source must be verified for Halal compliance' },
  { keyword: 'lard', severity: 'block', reason: 'Lard prohibited without explicit Halal exemption labeling' },
  { keyword: 'alcohol', severity: 'warn', reason: 'Alcohol restricted to licensed channels only (Permendag 20/2021)' },
  { keyword: 'beer', severity: 'warn', reason: 'Alcoholic beverages restricted to licensed channels' },
  { keyword: 'wine', severity: 'warn', reason: 'Alcoholic beverages restricted to licensed channels' },
  { keyword: 'gambling', severity: 'block', reason: 'Gambling-related products prohibited' },
  { keyword: 'pornograph', severity: 'block', reason: 'Pornographic material prohibited under Indonesian law' },
  { keyword: 'weapon', severity: 'block', reason: 'Weapons prohibited for civilian sale' },
]

const DE_KEYWORDS: readonly ProhibitedKeywordEntry[] = [
  { keyword: 'nazi', severity: 'block', reason: 'Nazi symbols/memorabilia prohibited under §86a StGB' },
  { keyword: 'swastika', severity: 'block', reason: 'Swastika display prohibited under §86a StGB' },
  { keyword: 'hakenkreuz', severity: 'block', reason: 'Hakenkreuz prohibited under §86a StGB' },
  { keyword: 'ss insignia', severity: 'block', reason: 'SS insignia prohibited under §86a StGB' },
  { keyword: 'switchblade', severity: 'block', reason: 'Switchblades prohibited under Waffengesetz §42a' },
  { keyword: 'butterfly knife', severity: 'block', reason: 'Butterfly knives prohibited under Waffengesetz §42a' },
  { keyword: 'counterfeit', severity: 'block', reason: 'Counterfeit goods prohibited under MarkenG' },
  { keyword: 'replica brand', severity: 'block', reason: 'Counterfeit branded goods prohibited' },
  { keyword: 'fake designer', severity: 'block', reason: 'Imitation luxury goods prohibited under EU IP law' },
]

const US_KEYWORDS: readonly ProhibitedKeywordEntry[] = [
  { keyword: 'fda unapproved', severity: 'block', reason: 'Unapproved FDA products prohibited for sale' },
  { keyword: 'lead paint toy', severity: 'block', reason: 'Lead-containing toys prohibited under CPSIA' },
  { keyword: 'uncertified electronic', severity: 'warn', reason: 'Electronics require FCC certification for US sale' },
  { keyword: 'kinder surprise', severity: 'block', reason: 'Kinder Surprise eggs prohibited under FFDCA (non-nutritive object inside confectionery)' },
  { keyword: 'lawn dart', severity: 'block', reason: 'Lawn darts banned by CPSC since 1988' },
  { keyword: 'recalled product', severity: 'block', reason: 'CPSC recalled products may not be resold' },
  { keyword: 'ivory', severity: 'block', reason: 'Ivory sale prohibited under Endangered Species Act' },
  { keyword: 'drug paraphernalia', severity: 'block', reason: 'Drug paraphernalia prohibited under 21 USC §863' },
]

const CA_KEYWORDS: readonly ProhibitedKeywordEntry[] = [
  { keyword: 'baby walker', severity: 'block', reason: 'Baby walkers banned under Canada Consumer Product Safety Act (SOR/2004-197)' },
  { keyword: 'lawn dart', severity: 'block', reason: 'Lawn darts prohibited under Hazardous Products Act' },
  { keyword: 'unapproved natural health', severity: 'warn', reason: 'Natural health products require NPN (Natural Product Number) from Health Canada' },
  { keyword: 'uncertified electronic', severity: 'warn', reason: 'Electronics require ISED (Innovation, Science and Economic Development) certification' },
  { keyword: 'ivory', severity: 'block', reason: 'Ivory sale prohibited under Wild Animal and Plant Protection Act' },
]

const MX_KEYWORDS: readonly ProhibitedKeywordEntry[] = [
  { keyword: 'pirotecnia', severity: 'block', reason: 'Sale of fireworks restricted under Mexican federal explosives law (Ley Federal de Armas de Fuego y Explosivos)' },
  { keyword: 'firework', severity: 'block', reason: 'Fireworks restricted under federal explosives regulation' },
  { keyword: 'medicamento sin registro', severity: 'block', reason: 'Unregistered medicines prohibited (COFEPRIS regulation)' },
  { keyword: 'suplemento no registrado', severity: 'warn', reason: 'Unregistered supplements require COFEPRIS approval' },
  { keyword: 'arma', severity: 'block', reason: 'Weapons prohibited for civilian sale without SEDENA permit' },
]

export const PROHIBITED_KEYWORDS: Readonly<Record<ComplianceMarket, readonly ProhibitedKeywordEntry[]>> = {
  SG: SG_KEYWORDS,
  ID: ID_KEYWORDS,
  DE: DE_KEYWORDS,
  US: US_KEYWORDS,
  CA: CA_KEYWORDS,
  MX: MX_KEYWORDS,
}

// ─── Category Restrictions per Market ─────────────────────────────────────────

export interface CategoryRestriction {
  category: string
  restriction: 'prohibited' | 'requires_certification' | 'requires_license'
  certificationName?: string
  reason: string
}

const SG_CATEGORY_RESTRICTIONS: readonly CategoryRestriction[] = [
  { category: 'electronics', restriction: 'requires_certification', certificationName: 'IMDA', reason: 'Electronics require IMDA certification for Singapore market' },
  { category: 'food', restriction: 'requires_certification', certificationName: 'SFA', reason: 'Food products require SFA (Singapore Food Agency) approval' },
  { category: 'cosmetics', restriction: 'requires_certification', certificationName: 'HSA', reason: 'Cosmetics require HSA notification' },
]

const ID_CATEGORY_RESTRICTIONS: readonly CategoryRestriction[] = [
  { category: 'food', restriction: 'requires_certification', certificationName: 'BPOM', reason: 'Food products require BPOM registration (Badan Pengawas Obat dan Makanan)' },
  { category: 'cosmetics', restriction: 'requires_certification', certificationName: 'BPOM', reason: 'Cosmetics require BPOM registration' },
  { category: 'food', restriction: 'requires_certification', certificationName: 'Halal', reason: 'Food products targeting Muslim consumers require Halal certification (BPJPH)' },
  { category: 'pharmaceuticals', restriction: 'requires_license', reason: 'Pharmaceuticals require BPOM distribution license' },
]

const DE_CATEGORY_RESTRICTIONS: readonly CategoryRestriction[] = [
  { category: 'electronics', restriction: 'requires_certification', certificationName: 'WEEE', reason: 'Electronics require WEEE registration under ElektroG' },
  { category: 'packaging', restriction: 'requires_certification', certificationName: 'VerpackG', reason: 'All packaged goods require Lucid registration under VerpackG' },
  { category: 'toys', restriction: 'requires_certification', certificationName: 'CE', reason: 'Toys require CE marking under EU Toy Safety Directive 2009/48/EC' },
]

const US_CATEGORY_RESTRICTIONS: readonly CategoryRestriction[] = [
  { category: 'electronics', restriction: 'requires_certification', certificationName: 'FCC', reason: 'Electronics require FCC ID for US market' },
  { category: 'toys', restriction: 'requires_certification', certificationName: 'CPSC', reason: 'Toys and children products require CPSC testing certificate' },
  { category: 'food', restriction: 'requires_certification', certificationName: 'FDA', reason: 'Food products require FDA facility registration' },
  { category: 'supplements', restriction: 'requires_certification', certificationName: 'FDA', reason: 'Dietary supplements must comply with FDA DSHEA requirements' },
]

const CA_CATEGORY_RESTRICTIONS: readonly CategoryRestriction[] = [
  { category: 'electronics', restriction: 'requires_certification', certificationName: 'ISED', reason: 'Electronics require ISED certification for Canadian market' },
  { category: 'food', restriction: 'requires_certification', certificationName: 'CFIA', reason: 'Food products require CFIA (Canadian Food Inspection Agency) compliance' },
  { category: 'children', restriction: 'requires_certification', certificationName: 'HC', reason: 'Children\'s products require Health Canada safety standards compliance' },
]

const MX_CATEGORY_RESTRICTIONS: readonly CategoryRestriction[] = [
  { category: 'food', restriction: 'requires_certification', certificationName: 'COFEPRIS', reason: 'Food products require COFEPRIS sanitary registration for Mexico' },
  { category: 'cosmetics', restriction: 'requires_certification', certificationName: 'COFEPRIS', reason: 'Cosmetics require COFEPRIS notification for Mexico market' },
  { category: 'electronics', restriction: 'requires_certification', certificationName: 'NOM', reason: 'Electronics require NOM certification (Norma Oficial Mexicana)' },
]

export const CATEGORY_RESTRICTIONS: Readonly<Record<ComplianceMarket, readonly CategoryRestriction[]>> = {
  SG: SG_CATEGORY_RESTRICTIONS,
  ID: ID_CATEGORY_RESTRICTIONS,
  DE: DE_CATEGORY_RESTRICTIONS,
  US: US_CATEGORY_RESTRICTIONS,
  CA: CA_CATEGORY_RESTRICTIONS,
  MX: MX_CATEGORY_RESTRICTIONS,
}

// ─── HS Code Risk Prefixes ────────────────────────────────────────────────────

export interface HSCodeRisk {
  prefix: string
  description: string
  severity: ComplianceSeverity
  requiredCerts: string[]
}

export const HS_CODE_RISKS: readonly HSCodeRisk[] = [
  { prefix: '8471', description: 'Automatic data processing machines (computers)', severity: 'warn', requiredCerts: ['FCC', 'CE'] },
  { prefix: '8517', description: 'Telephone/communication apparatus', severity: 'warn', requiredCerts: ['FCC', 'IMDA'] },
  { prefix: '9503', description: 'Toys, models, puzzles', severity: 'warn', requiredCerts: ['CPSC', 'CE'] },
  { prefix: '3304', description: 'Beauty/makeup preparations', severity: 'info', requiredCerts: ['BPOM', 'HSA'] },
  { prefix: '2106', description: 'Food preparations not elsewhere specified', severity: 'info', requiredCerts: ['FDA', 'BPOM', 'SFA'] },
  { prefix: '9306', description: 'Bombs, grenades, ammunition', severity: 'block', requiredCerts: [] },
  { prefix: '3603', description: 'Detonating fuses, detonators, pyrotechnics', severity: 'block', requiredCerts: [] },
]
