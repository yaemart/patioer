import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const AUTH_COOKIE_NAME = 'eos_token'
const DEFAULT_TENANT_PATH = '/dashboard'
const DEFAULT_OPS_PATH = '/ops'
const LOGIN_PATH = '/login'

const AUTH_PAGE_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/onboarding',
])

const TENANT_ROUTE_PREFIXES = [
  '/dashboard',
  '/approvals',
  '/agents',
  '/products',
  '/orders',
  '/ads',
  '/inventory',
  '/platforms',
  '/goals',
  '/clipmart',
  '/settings',
]

function isPathOrChild(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function isTenantRoute(pathname: string): boolean {
  return TENANT_ROUTE_PREFIXES.some((prefix) => isPathOrChild(pathname, prefix))
}

function isOpsRoute(pathname: string): boolean {
  return isPathOrChild(pathname, '/ops')
}

function redirectTo(request: NextRequest, pathname: string): NextResponse {
  return NextResponse.redirect(new URL(pathname, request.url))
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  return atob(`${normalized}${padding}`)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function verifyJwt(token: string): Promise<{ role?: string; exp?: number } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  const secret = process.env.JWT_SECRET ?? 'dev-only-secret-not-for-production'
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`))
  const expectedSignature = toBase64Url(new Uint8Array(signed))

  if (expectedSignature !== signature) return null

  const decoded = JSON.parse(decodeBase64Url(payload)) as { role?: string; exp?: number }
  if (typeof decoded.exp === 'number' && decoded.exp < Math.floor(Date.now() / 1000)) {
    return null
  }
  return decoded
}

function getDefaultPath(role: string | undefined): string {
  return role === 'admin' ? DEFAULT_OPS_PATH : DEFAULT_TENANT_PATH
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthPage = AUTH_PAGE_PATHS.has(pathname)
  const isProtectedTenantRoute = isTenantRoute(pathname)
  const isProtectedOpsRoute = isOpsRoute(pathname)

  if (!token) {
    if (isProtectedTenantRoute || isProtectedOpsRoute) {
      return redirectTo(request, LOGIN_PATH)
    }
    return NextResponse.next()
  }

  const payload = await verifyJwt(token)
  if (!payload) {
    const response = redirectTo(request, LOGIN_PATH)
    response.cookies.delete(AUTH_COOKIE_NAME)
    return response
  }

  const defaultPath = getDefaultPath(payload.role)

  if (pathname === '/' || isAuthPage) {
    return redirectTo(request, defaultPath)
  }

  if (isProtectedOpsRoute && payload.role !== 'admin') {
    return redirectTo(request, DEFAULT_TENANT_PATH)
  }

  if (payload.role === 'admin' && pathname === DEFAULT_TENANT_PATH) {
    return redirectTo(request, DEFAULT_OPS_PATH)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/register',
    '/onboarding',
    '/dashboard/:path*',
    '/approvals/:path*',
    '/agents/:path*',
    '/products/:path*',
    '/orders/:path*',
    '/ads/:path*',
    '/inventory/:path*',
    '/platforms/:path*',
    '/goals/:path*',
    '/clipmart/:path*',
    '/settings/:path*',
    '/ops/:path*',
  ],
}
