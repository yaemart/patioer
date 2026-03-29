/**
 * Re-export onboarding-related Drizzle tables from the centralized DB schema.
 * Domain packages import from here for type inference; actual table
 * definitions live in @patioer/db to keep migration tooling co-located.
 */
export { onboardingProgress } from '@patioer/db/schema/onboarding'
