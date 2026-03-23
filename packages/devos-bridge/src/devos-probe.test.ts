import { describe, expect, it, vi } from 'vitest'
import { probeDevOsHttpBaseUrl } from './devos-probe.js'

describe('probeDevOsHttpBaseUrl', () => {
  it('returns true on 200', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    await expect(probeDevOsHttpBaseUrl('http://localhost:3200', { fetch })).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledWith('http://localhost:3200/', expect.any(Object))
  })

  it('returns true on 404', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(probeDevOsHttpBaseUrl('http://x/', { fetch })).resolves.toBe(true)
  })

  it('returns true on 302', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 302 }))
    await expect(probeDevOsHttpBaseUrl('http://x/', { fetch })).resolves.toBe(true)
  })

  it('returns false on 502', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    await expect(probeDevOsHttpBaseUrl('http://x/', { fetch })).resolves.toBe(false)
  })

  it('returns false when fetch throws', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('econnrefused'))
    await expect(probeDevOsHttpBaseUrl('http://x/', { fetch })).resolves.toBe(false)
  })
})
