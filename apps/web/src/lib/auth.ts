const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100'

interface LoginApiResponse {
  token?: string
  tenantId: string
  userId?: string
}

interface AuthMeResponse {
  email?: string
  role?: string
}

interface AppToken {
  tenantId?: string
  role?: string
  accessToken?: string
}

interface AppAuthConfig {
  providers: Array<Record<string, unknown>>
  session: { strategy: 'jwt' }
  pages: {
    signIn: string
    newUser: string
  }
  callbacks: {
    jwt(args: { token: AppToken & Record<string, unknown>; user?: Record<string, unknown> | null }): AppToken & Record<string, unknown>
    session(args: { session: { user?: Record<string, unknown> | null }; token: AppToken & Record<string, unknown> }): { user?: Record<string, unknown> | null }
  }
}

export const authConfig: AppAuthConfig = {
  providers: [
    {
      id: 'credentials',
      name: 'Credentials',
      type: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials: Record<string, string> | undefined) {
        if (!credentials?.email || !credentials?.password) return null

        const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        })

        if (!res.ok) return null

        const data = (await res.json()) as LoginApiResponse
        const accessToken = typeof data.token === 'string' ? data.token : null
        let profile: AuthMeResponse | null = null

        if (accessToken) {
          const profileRes = await fetch(`${API_BASE}/api/v1/auth/me`, {
            headers: { authorization: `Bearer ${accessToken}` },
          })
          if (profileRes.ok) {
            profile = (await profileRes.json()) as AuthMeResponse
          }
        }

        return {
          id: data.userId ?? data.tenantId,
          email: typeof profile?.email === 'string' ? profile.email : credentials.email,
          tenantId: data.tenantId,
          role: typeof profile?.role === 'string' ? profile.role : undefined,
          accessToken,
        }
      },
    },
  ],
  session: { strategy: 'jwt' as const },
  pages: {
    signIn: '/login',
    newUser: '/onboarding',
  },
  callbacks: {
    jwt({ token, user }: { token: AppToken & Record<string, unknown>; user?: Record<string, unknown> | null }) {
      if (user) {
        token.tenantId = typeof user.tenantId === 'string' ? user.tenantId : undefined
        token.role = typeof user.role === 'string' ? user.role : undefined
        token.accessToken = typeof user.accessToken === 'string' ? user.accessToken : undefined
      }
      return token
    },
    session({ session, token }: { session: { user?: Record<string, unknown> | null }; token: AppToken & Record<string, unknown> }) {
      if (session.user) {
        (session.user as Record<string, unknown>).tenantId = token.tenantId
        ;(session.user as Record<string, unknown>).role = token.role
        ;(session.user as Record<string, unknown>).accessToken = token.accessToken
      }
      return session
    },
  },
}
