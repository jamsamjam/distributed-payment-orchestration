import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PulsePay — Live Operations Dashboard',
  description: 'Real-time payment orchestration monitoring',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  )
}
