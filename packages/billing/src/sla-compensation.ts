import type { PlanName } from './billing.types.js'
import { SLA_LEVELS } from '@patioer/shared'

export type SlaIncidentType =
  | 'dataos_data_loss'
  | 'agent_unapproved_action'

export interface SlaIncident {
  type: SlaIncidentType
  durationMinutes?: number
}

export interface CompensationResult {
  plan: PlanName
  slaUptime: number
  actualUptime: number
  uptimeCompensationPct: number
  incidentCompensationPct: number
  totalCompensationPct: number
}

export function calculateSlaCompensation(
  plan: PlanName,
  actualUptime: number,
  incidents: SlaIncident[],
): CompensationResult {
  const slaUptime = SLA_LEVELS[plan].uptime

  let uptimeCompensationPct = 0

  if (actualUptime < 95) {
    uptimeCompensationPct = 100
  } else if (actualUptime < 99) {
    uptimeCompensationPct = 30
  } else if (actualUptime < slaUptime) {
    const shortfallTenths = Math.round((slaUptime - actualUptime) * 10)
    uptimeCompensationPct = shortfallTenths * 5
  }

  let incidentCompensationPct = 0

  for (const incident of incidents) {
    switch (incident.type) {
      case 'dataos_data_loss':
        if (incident.durationMinutes !== undefined && incident.durationMinutes > 60) {
          incidentCompensationPct = Math.max(incidentCompensationPct, 20)
        }
        break
      case 'agent_unapproved_action':
        incidentCompensationPct = Math.max(incidentCompensationPct, 100)
        break
    }
  }

  const totalCompensationPct = Math.min(
    uptimeCompensationPct + incidentCompensationPct,
    100,
  )

  return {
    plan,
    slaUptime,
    actualUptime,
    uptimeCompensationPct,
    incidentCompensationPct,
    totalCompensationPct,
  }
}
