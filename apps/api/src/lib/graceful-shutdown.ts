export async function gracefulShutdown(
  closeApp: () => Promise<void>,
  closeRedis: () => Promise<void>,
  closeQueues?: () => Promise<void>,
): Promise<number> {
  try {
    await closeApp()
    if (closeQueues) await closeQueues()
    await closeRedis()
    return 0
  } catch {
    return 1
  }
}
