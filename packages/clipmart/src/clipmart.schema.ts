/**
 * Re-export ClipMart-related Drizzle tables from the centralized DB schema.
 * Domain packages import from here for type inference; actual table
 * definitions live in @patioer/db to keep migration tooling co-located.
 */
export { clipmartTemplates, templateReviews } from '@patioer/db/schema/clipmart'
