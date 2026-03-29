import type { Market, CertificationBody } from './types.js'

/**
 * Categories that are completely prohibited in each market.
 * Agents must NEVER list products matching these categories.
 * Source: platform seller policies 2024-2026.
 *
 * Matching uses exact or prefix match on kebab-case slugs.
 * e.g. 'controlled-drugs' matches 'controlled-drugs-opioids'.
 */
export const PROHIBITED_CATEGORIES: Record<Market, string[]> = {
  SG: [
    'tobacco',
    'chewing-gum',
    'firecrackers',
    'controlled-drugs',
    'endangered-species',
    'replica-weapons',
  ],
  MY: [
    'tobacco-oral',
    'vaping-liquid',
    'controlled-drugs',
    'counterfeit-goods',
    'endangered-species',
  ],
  TH: [
    'gambling-equipment',
    'prescription-drugs-otc',
    'controlled-drugs',
    'antiques-without-permit',
    'counterfeit-goods',
  ],
  ID: [
    'alcohol-spirits',
    'controlled-drugs',
    'pornographic-material',
    'counterfeit-goods',
    'weapons',
    'bpom-unregistered-health',
  ],
  UK: [
    'live-animals',
    'human-body-parts',
    'prescription-drugs',
    'controlled-drugs',
    'offensive-weapons',
  ],
  DE: [
    'nazi-memorabilia',
    'controlled-drugs',
    'prescription-drugs',
    'surveillance-equipment',
    'counterfeit-goods',
  ],
  US: [
    'controlled-drugs',
    'counterfeit-goods',
    'recalled-products',
    'weapons-automatic',
    'hazardous-materials-unclassified',
    'surveillance-equipment-illegal',
  ],
  CA: [
    'controlled-drugs',
    'counterfeit-goods',
    'recalled-products',
    'weapons-prohibited',
    'tobacco',
  ],
  MX: [
    'controlled-drugs',
    'counterfeit-goods',
    'weapons',
    'tobacco',
    'hazardous-materials-unclassified',
  ],
}

/**
 * Certification bodies required per category per market.
 * An empty record for a market means no tracked requirements (not "no requirements").
 * Matching uses exact or prefix match — see compliance.ts getRequiredCertifications.
 */
export const CERTIFICATION_REQUIREMENTS: Record<Market, Record<string, CertificationBody[]>> = {
  SG: {
    'electronics':        ['IMDA'],
    'food-supplements':   ['SFA'],
    'medical-devices':    ['HSA'],
    'telecommunications': ['IMDA'],
  },
  MY: {
    'electronics':      ['SIRIM'],
    'electrical-goods': ['SIRIM'],
    'food-supplements': ['MOH'],
  },
  TH: {
    'food-supplements': ['FDA'],
    'cosmetics':        ['FDA'],
  },
  ID: {
    'food-supplements': ['BPOM'],
    'cosmetics':        ['BPOM'],
    'medical-devices':  ['BPOM'],
  },
  UK: {
    'electronics':      ['UKCA', 'WEEE'],
    'electrical-goods': ['UKCA'],
    'toys':             ['UKCA'],
  },
  DE: {
    'electronics':      ['WEEE'],
    'electrical-goods': ['WEEE'],
    'batteries':        ['WEEE'],
  },
  US: {
    'electronics':       ['FCC'],
    'food-supplements':  ['FDA_US'],
    'medical-devices':   ['FDA_US'],
    'cosmetics':         ['FDA_US'],
    'children-products': ['CPSC'],
    'toys':              ['CPSC'],
  },
  CA: {
    'electronics':       ['ISED'],
    'food-supplements':  ['HC'],
    'medical-devices':   ['HC'],
    'natural-health':    ['HC'],
  },
  MX: {
    'food-supplements':  ['COFEPRIS'],
    'medical-devices':   ['COFEPRIS'],
    'cosmetics':         ['COFEPRIS'],
  },
}
