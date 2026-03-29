/**
 * Re-export growth-related Drizzle tables from the centralized DB schema.
 * Domain packages import from here for type inference; actual table
 * definitions live in @patioer/db to keep migration tooling co-located.
 */
export { referralCodes, referralRewards, npsResponses } from '@patioer/db/schema/growth'
