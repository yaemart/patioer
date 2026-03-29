export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">
          ElectroOS
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          AI-powered e-commerce operations platform
        </p>
        <div className="mt-8 flex gap-4 justify-center">
          <a
            href="/login"
            className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors"
          >
            Sign In
          </a>
          <a
            href="/register"
            className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-colors"
          >
            Get Started
          </a>
        </div>
      </div>
    </main>
  )
}
