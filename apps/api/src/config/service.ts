import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const getPackageServiceName = (): string => {
  try {
    const currentFilePath = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFilePath)
    const packageJsonPath = resolve(currentDir, '../../package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string
    }

    return packageJson.name ?? 'api'
  } catch {
    return 'api'
  }
}

export const SERVICE_IDENTIFIER =
  process.env.SERVICE_IDENTIFIER ?? getPackageServiceName()
