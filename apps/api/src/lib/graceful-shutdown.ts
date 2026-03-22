export async function gracefulShutdown(
  closeApp: () => Promise<void>,
  closeRedis: () => Promise<void>,
): Promise<number> {
  try {
    await closeApp()
    await closeRedis()
    return 0
  } catch {
    return 1
  }
}
