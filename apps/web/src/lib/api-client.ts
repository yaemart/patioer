const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100'

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as Record<string, string>).message ?? `API error ${res.status}`,
    )
  }

  return res.json() as Promise<T>
}
