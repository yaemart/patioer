'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Credential {
  id: string
  platform: string
  credentialType: string
  shopDomain: string | null
  region: string | null
  scopes: string[] | null
  metadata: Record<string, unknown> | null
  expiresAt: string | null
  createdAt: string
}

const ALL_PLATFORMS = [
  { id: 'shopify', name: 'Shopify', color: 'border-green-300 bg-green-50', dot: 'bg-green-500', description: 'E-commerce storefront and product management' },
  { id: 'amazon', name: 'Amazon', color: 'border-orange-300 bg-orange-50', dot: 'bg-orange-500', description: 'Marketplace listings, FBA, and advertising' },
  { id: 'tiktok', name: 'TikTok Shop', color: 'border-gray-300 bg-gray-50', dot: 'bg-gray-700', description: 'Social commerce and live shopping' },
  { id: 'shopee', name: 'Shopee', color: 'border-red-300 bg-red-50', dot: 'bg-red-500', description: 'Southeast Asia marketplace' },
  { id: 'walmart', name: 'Walmart', color: 'border-blue-300 bg-blue-50', dot: 'bg-blue-500', description: 'US marketplace and fulfillment' },
] as const

export default function PlatformsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<{ credentials: Credential[] }>('/api/v1/platform-credentials')
      .then((data) => setCredentials(data.credentials))
      .catch(() => setCredentials([]))
      .finally(() => setLoading(false))
  }, [])

  const connected = new Map(credentials.map((c) => [c.platform, c]))

  function isExpired(cred: Credential): boolean {
    return cred.expiresAt ? new Date(cred.expiresAt) < new Date() : false
  }

  if (loading) {
    return (
      <main className="py-8 px-6">
        <div className="text-gray-500">Loading platforms...</div>
      </main>
    )
  }

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Platforms</h1>
          <p className="text-sm text-gray-500 mt-1">
            {credentials.length} connected / {ALL_PLATFORMS.length} supported
          </p>
        </div>

        <div className="space-y-4">
          {ALL_PLATFORMS.map((plat) => {
            const cred = connected.get(plat.id)
            const expired = cred ? isExpired(cred) : false

            return (
              <div
                key={plat.id}
                className={`rounded-xl border p-5 transition-all ${
                  cred && !expired
                    ? plat.color
                    : expired
                      ? 'border-amber-300 bg-amber-50/50'
                      : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${cred && !expired ? plat.dot : expired ? 'bg-amber-500' : 'bg-gray-300'}`} />
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{plat.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{plat.description}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {cred ? (
                      <>
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          expired ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {expired ? 'Expired' : 'Connected'}
                        </span>
                        <p className="text-[10px] text-gray-400 mt-1">
                          Since {new Date(cred.createdAt).toLocaleDateString()}
                        </p>
                      </>
                    ) : (
                      <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        Not Connected
                      </span>
                    )}
                  </div>
                </div>

                {cred && (
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <p className="text-[10px] text-gray-400">Type</p>
                      <p className="text-xs font-medium text-gray-700">{cred.credentialType}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400">Region</p>
                      <p className="text-xs font-medium text-gray-700">{cred.region ?? 'global'}</p>
                    </div>
                    {cred.shopDomain && (
                      <div>
                        <p className="text-[10px] text-gray-400">Shop Domain</p>
                        <p className="text-xs font-medium text-gray-700">{cred.shopDomain}</p>
                      </div>
                    )}
                    {cred.expiresAt && (
                      <div>
                        <p className="text-[10px] text-gray-400">Expires</p>
                        <p className={`text-xs font-medium ${expired ? 'text-red-600' : 'text-gray-700'}`}>
                          {new Date(cred.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                    {cred.scopes && cred.scopes.length > 0 && (
                      <div className="col-span-2 sm:col-span-4">
                        <p className="text-[10px] text-gray-400">Scopes</p>
                        <div className="flex gap-1 flex-wrap mt-0.5">
                          {cred.scopes.map((s) => (
                            <span key={s} className="rounded bg-white/70 border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!cred && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-400">
                      Connect via Settings or complete the onboarding wizard to authorize {plat.name}.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
