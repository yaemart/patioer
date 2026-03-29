'use client'

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

interface TemplateCardProps {
  template: Template
}

export function TemplateCard({ template }: TemplateCardProps) {
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
            <span className="text-xs text-gray-400 mt-0.5 block">{template.category}</span>
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
