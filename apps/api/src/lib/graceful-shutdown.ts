export async function gracefulShutdown(
  closeApp: () => Promise<void>,
  closeRedis: () => Promise<void>,
  closeQueues?: () => Promise<void>,
): Promise<number> {
  let failed = false
  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch {
      failed = true
    }
  }

  await attempt(closeApp)
  if (closeQueues) await attempt(closeQueues)
  await attempt(closeRedis)

  return failed ? 1 : 0
}
