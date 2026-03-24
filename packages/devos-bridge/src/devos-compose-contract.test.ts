import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const composeYaml = readFileSync(
  new URL('../../../docker-compose.devos.yml', import.meta.url),
  'utf8',
)

describe('docker-compose.devos.yml', () => {
  it('mounts the local paperclip checkout explicitly', () => {
    expect(composeYaml).toContain('./paperclip:/workspace/paperclip')
    expect(composeYaml).not.toContain('./:/workspace')
  })

  it('keeps expected ports and startup guard', () => {
    expect(composeYaml).toContain("'3200:3000'")
    expect(composeYaml).toContain("'5433:5432'")
    expect(composeYaml).toContain('Missing ./paperclip checkout.')
  })
})
