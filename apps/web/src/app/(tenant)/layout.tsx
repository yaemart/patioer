import Sidebar from '@/components/Sidebar'

export default function TenantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 pl-60">{children}</div>
    </div>
  )
}
