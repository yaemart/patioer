'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import Link from 'next/link'

interface Template {
  id: string
  name: string
  description: string | null
  category: string
  targetMarkets: string[]
  platforms: string[]
  downloads: number
  rating: number | null
  isOfficial: boolean
}

const CATEGORIES = ['all', 'full-stack', 'sea', 'advertising', 'fashion', 'b2b']
const PLATFORM_OPTIONS = ['shopify', 'amazon', 'tiktok', 'shopee']

export default function ClipmartPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [officialOnly, setOfficialOnly] = useState(false)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('query', query)
      if (category !== 'all') params.set('category', category)
      if (selectedPlatforms.length > 0) params.set('platforms', selectedPlatforms.join(','))
      if (officialOnly) params.set('official', 'true')

      const qs = params.toString()
      const data = await apiFetch<Template[]>(`/api/v1/clipmart/templates${qs ? `?${qs}` : ''}`)
      setTemplates(data)
    } catch {
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [query, category, selectedPlatforms, officialOnly])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    )
  }

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ClipMart</h1>
            <p className="text-sm text-gray-500 mt-1">
              Browse and import agent configuration templates
            </p>
          </div>
          <span className="text-xs text-gray-400">{templates.length} templates</span>
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search templates (e.g. 定价, cross-border, PPC)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-colors"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={officialOnly}
                onChange={(e) => setOfficialOnly(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Official only
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  category === c
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c === 'all' ? 'All Categories' : c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => togglePlatform(p)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedPlatforms.includes(p)
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500">Loading templates...</div>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-gray-500 text-lg">No templates found</p>
            <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function TemplateCard({ template }: { template: Template }) {
  return (
    <Link href={`/clipmart/${template.id}`} className="block">
      <div className="rounded-xl border border-gray-200 bg-white p-5 hover:border-indigo-300 hover:shadow-md transition-all">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 truncate">{template.name}</h3>
              {template.isOfficial && (
                <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                  Official
                </span>
              )}
            </div>
            <span className="text-xs text-gray-400 mt-0.5 block">
              {template.category}
            </span>
          </div>
        </div>

        {template.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-3">{template.description}</p>
        )}

        <div className="flex flex-wrap gap-1 mb-3">
          {template.platforms.map((p) => (
            <span
              key={p}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
            >
              {p}
            </span>
          ))}
          {template.targetMarkets.slice(0, 4).map((m) => (
            <span
              key={m}
              className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600"
            >
              {m}
            </span>
          ))}
          {template.targetMarkets.length > 4 && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
              +{template.targetMarkets.length - 4}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{template.downloads} downloads</span>
          {template.rating !== null && (
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {template.rating}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
