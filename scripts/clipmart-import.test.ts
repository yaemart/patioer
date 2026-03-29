import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import {
  executeImport,
  loadTemplate,
  normalizeTemplateDocument,
  parseArgs,
} from './clipmart-import.js'

const LEGACY_TEMPLATE_PATH = resolve(import.meta.dirname ?? '.', '../harness-config/clipmart-template.json')
const MODERN_TEMPLATE_PATH = resolve(import.meta.dirname ?? '.', '../harness-config/official-templates/standard-cross-border.json')

describe('clipmart-import script', () => {
  it('parses tenant and template args', () => {
    expect(
      parseArgs(['--tenant=123e4567-e89b-12d3-a456-426614174000', '--template=custom.json']),
    ).toEqual({
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      templatePath: resolve('custom.json'),
    })
  })

  it('normalizes legacy template documents into ClipMart templates', () => {
    const template = loadTemplate(LEGACY_TEMPLATE_PATH)

    expect(template.id).toBe('standard-cross-border-ecommerce')
    expect(template.platforms).toEqual(['shopify', 'amazon', 'tiktok', 'shopee'])
    expect(template.config).toMatchObject({
      governance: expect.objectContaining({
        monthlyBudgetUsd: 50,
      }),
    })
  })

  it('normalizes modern template documents into ClipMart templates', () => {
    const template = loadTemplate(MODERN_TEMPLATE_PATH)

    expect(template.id).toBe('standard-cross-border')
    expect(template.category).toBe('full-stack')
    expect(template.platforms).toEqual(['shopify', 'amazon'])
    expect(template.config).toMatchObject({
      governance: expect.objectContaining({
        monthlyBudgetUsd: 430,
      }),
    })
  })

  it('supports direct normalization of modern payloads without templateId', () => {
    const template = normalizeTemplateDocument(
      {
        name: 'Custom',
        category: 'sea',
        config: { agents: [{ type: 'product-scout', name: 'Scout', status: 'active' }] },
      },
      '/tmp/custom-template.json',
    )

    expect(template.id).toBe('custom-template')
    expect(template.category).toBe('sea')
  })

  it('executes import through the formal import service path', async () => {
    const agentManager = {
      upsertAgent: vi.fn().mockResolvedValue(undefined),
    }
    const eventRecorder = {
      record: vi.fn().mockResolvedValue(undefined),
    }
    const template = loadTemplate(MODERN_TEMPLATE_PATH)

    const result = await executeImport(
      '123e4567-e89b-12d3-a456-426614174000',
      template,
      { agentManager, eventRecorder },
    )

    expect(result.templateId).toBe('standard-cross-border')
    expect(result.agentsImported).toBe(9)
    expect(result.downloads).toBe(1)
    expect(agentManager.upsertAgent).toHaveBeenCalledTimes(9)
    expect(eventRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        eventType: 'template_imported',
      }),
    )
  })
})
