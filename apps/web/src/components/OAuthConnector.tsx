'use client'

import { useState } from 'react'

const PLATFORMS = [
  { id: 'shopify', label: 'Shopify', color: 'bg-green-100 text-green-700 border-green-300' },
  { id: 'amazon', label: 'Amazon', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  { id: 'tiktok', label: 'TikTok Shop', color: 'bg-pink-100 text-pink-700 border-pink-300' },
  { id: 'shopee', label: 'Shopee', color: 'bg-red-100 text-red-700 border-red-300' },
] as const

type OAuthStatus = 'idle' | 'connecting' | 'success' | 'failed'

interface OAuthConnectorProps {
  selectedPlatforms: string[]
  onToggle: (platformId: string) => void
  onConnect: (platforms: string[]) => Promise<void>
  disabled?: boolean
}

export function OAuthConnector({ selectedPlatforms, onToggle, onConnect, disabled }: OAuthConnectorProps) {
  const [statuses, setStatuses] = useState<Record<string, OAuthStatus>>({})

  async function handleConnect() {
    for (const p of selectedPlatforms) {
      setStatuses((prev) => ({ ...prev, [p]: 'connecting' }))
    }
    try {
      await onConnect(selectedPlatforms)
      for (const p of selectedPlatforms) {
        setStatuses((prev) => ({ ...prev, [p]: 'success' }))
      }
    } catch {
      for (const p of selectedPlatforms) {
        setStatuses((prev) => ({ ...prev, [p]: 'failed' }))
      }
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {PLATFORMS.map((p) => {
          const isSelected = selectedPlatforms.includes(p.id)
          const status = statuses[p.id]
          return (
            <button
              key={p.id}
              onClick={() => onToggle(p.id)}
              disabled={disabled}
              className={`relative rounded-lg border-2 p-4 text-sm font-medium transition-all ${
                isSelected ? `${p.color} border-current` : 'border-gray-200 text-gray-600 hover:border-gray-300'
              } disabled:opacity-50`}
            >
              {p.label}
              {status === 'success' && (
                <span className="absolute top-1 right-1 text-green-600 text-xs font-bold">&#10003;</span>
              )}
              {status === 'connecting' && (
                <span className="absolute top-1 right-1 text-gray-400 text-xs animate-pulse">...</span>
              )}
              {status === 'failed' && (
                <span className="absolute top-1 right-1 text-red-500 text-xs font-bold">!</span>
              )}
            </button>
          )
        })}
      </div>
      <button
        onClick={handleConnect}
        disabled={disabled || selectedPlatforms.length === 0}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
      >
        {Object.values(statuses).some((s) => s === 'connecting') ? 'Connecting...' : `Connect ${selectedPlatforms.length} Platform${selectedPlatforms.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  )
}
