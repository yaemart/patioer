import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const inventoryInboundShipments = pgTable(
  'inventory_inbound_shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    platform: text('platform').notNull(),
    productId: text('product_id').notNull(),
    shipmentId: text('shipment_id'),
    quantity: integer('quantity').notNull(),
    status: text('status').notNull().default('in_transit'),
    expectedArrival: date('expected_arrival'),
    supplier: text('supplier'),
    leadTimeDays: integer('lead_time_days'),
    moq: integer('moq'),
    landedCostPerUnit: numeric('landed_cost_per_unit', { precision: 10, scale: 2 }),
    totalCost: numeric('total_cost', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
)

export type InventoryInboundShipment = typeof inventoryInboundShipments.$inferSelect
export type NewInventoryInboundShipment = typeof inventoryInboundShipments.$inferInsert
