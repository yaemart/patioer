'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import Link from 'next/link'

interface Template {
  id: string
  name: string
  description: string | null
  category: string
  targetMarkets: string[]
  targetCategories: string[]
  platforms: string[]
  config: Record<string, unknown>
  downloads: number
  rating: number | null
  isOfficial: boolean
  createdAt: string
}

interface Review {
  id: string
  tenantId: string
  rating: number
  comment: string | null
  gmvChange: number | null
  createdAt: string
}

interface UserInfo {
  tenantId: string
}

export default function TemplateDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [template, setTemplate] = useState<Template | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)

  const [newRating, setNewRating] = useState(5)
  const [newComment, setNewComment] = useState('')
  const [newGmvChange, setNewGmvChange] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [reviewResult, setReviewResult] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [tpl, revs, user] = await Promise.all([
        apiFetch<Template>(`/api/v1/clipmart/templates/${id}`),
        apiFetch<Review[]>(`/api/v1/clipmart/templates/${id}/reviews`),
        apiFetch<UserInfo>('/api/v1/auth/me').catch(() => null),
      ])
      setTemplate(tpl)
      setReviews(revs)
      if (user) setTenantId(user.tenantId)
    } catch {
      setTemplate(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleImport() {
    if (!tenantId) {
      router.push('/login')
      return
    }
    setImporting(true)
    setImportResult(null)
    try {
      const result = await apiFetch<{ agentsImported: number }>(
        `/api/v1/clipmart/templates/${id}/import`,
        {
          method: 'POST',
          headers: { 'x-tenant-id': tenantId },
          body: JSON.stringify({}),
        },
      )
      setImportResult(`Imported ${result.agentsImported} agents successfully!`)
      fetchData()
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function handleSubmitReview() {
    if (!tenantId) {
      router.push('/login')
      return
    }
    setSubmittingReview(true)
    setReviewResult(null)
    try {
      await apiFetch(`/api/v1/clipmart/templates/${id}/reviews`, {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId },
        body: JSON.stringify({
          rating: newRating,
          comment: newComment || undefined,
          gmvChange: newGmvChange === '' ? undefined : Number(newGmvChange),
        }),
      })
      setNewComment('')
      setNewGmvChange('')
      setReviewResult('Review submitted successfully.')
      fetchData()
    } catch (err) {
      setReviewResult(err instanceof Error ? err.message : 'Failed to submit review')
    } finally {
      setSubmittingReview(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">Loading template...</div>
      </main>
    )
  }

  if (!template) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-red-600 mb-2">Template Not Found</h1>
          <Link
            href="/clipmart"
            className="text-indigo-600 hover:text-indigo-500 text-sm"
          >
            Back to ClipMart
          </Link>
        </div>
      </main>
    )
  }

  const agents = Array.isArray(template.config.agents)
    ? (template.config.agents as { type: string; name: string; status: string }[])
    : []

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/clipmart"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to ClipMart
        </Link>

        <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">{template.name}</h1>
                {template.isOfficial && (
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                    Official
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">{template.category}</p>
            </div>
            <div className="text-right">
              {template.rating !== null && (
                <div className="flex items-center gap-1 text-sm">
                  <svg className="h-4 w-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="font-semibold">{template.rating}</span>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-0.5">{template.downloads} downloads</p>
            </div>
          </div>

          {template.description && (
            <p className="text-sm text-gray-600 mb-4">{template.description}</p>
          )}

          <div className="flex flex-wrap gap-1.5 mb-4">
            {template.platforms.map((p) => (
              <span key={p} className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {p}
              </span>
            ))}
            {template.targetMarkets.map((m) => (
              <span key={m} className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                {m}
              </span>
            ))}
          </div>

          <button
            onClick={handleImport}
            disabled={importing}
            className="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {importing ? 'Importing...' : 'Import Template'}
          </button>

          {importResult && (
            <p className={`mt-3 text-sm text-center ${importResult.includes('successfully') ? 'text-emerald-600' : 'text-red-600'}`}>
              {importResult}
            </p>
          )}
        </div>

        {agents.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Agent Configuration ({agents.length} agents)
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <div
                  key={agent.type}
                  className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{agent.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      agent.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {agent.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{agent.type}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Reviews ({reviews.length})
          </h2>

          {tenantId && (
            <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Leave a Review</h3>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-600">Rating:</span>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setNewRating(star)}
                    className="focus:outline-none"
                  >
                    <svg
                      className={`h-5 w-5 ${star <= newRating ? 'text-amber-400' : 'text-gray-300'}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </button>
                ))}
              </div>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Share your experience with this template..."
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-colors mb-3"
              />
              <input
                type="number"
                step="0.1"
                value={newGmvChange}
                onChange={(e) => setNewGmvChange(e.target.value)}
                placeholder="Optional GMV change (%)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-colors mb-3"
              />
              <button
                onClick={handleSubmitReview}
                disabled={submittingReview}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {submittingReview ? 'Submitting...' : 'Submit Review'}
              </button>
              {reviewResult && (
                <p className={`mt-3 text-sm ${reviewResult.includes('successfully') ? 'text-emerald-600' : 'text-red-600'}`}>
                  {reviewResult}
                </p>
              )}
            </div>
          )}

          {reviews.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No reviews yet. Be the first!</p>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id} className="border-b border-gray-100 pb-4 last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <svg
                          key={i}
                          className={`h-3.5 w-3.5 ${i < review.rating ? 'text-amber-400' : 'text-gray-200'}`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(review.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-gray-600">{review.comment}</p>
                  )}
                  {review.gmvChange !== null && (
                    <p className="text-xs text-gray-400 mt-1">
                      GMV change: {review.gmvChange > 0 ? '+' : ''}{review.gmvChange}%
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
