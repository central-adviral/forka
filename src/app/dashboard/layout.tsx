export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <nav className="mb-6 flex items-center justify-between border-b pb-4">
        <a href="/dashboard" className="font-semibold">AB Test Tool</a>
      </nav>
      {children}
    </div>
  )
}
