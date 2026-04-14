'use client'

import type { Metrics } from '@/app/page'

interface Props { metrics: Metrics }

function StatCard({ label, value, sub, color = 'text-white' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function MetricsStrip({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="Transactions/sec"
        value={metrics.tps.toFixed(1)}
        sub={`${metrics.totalTransactions} in window`}
        color="text-indigo-300"
      />
      <StatCard
        label="Approval Rate"
        value={`${metrics.approvalRate.toFixed(1)}%`}
        color={metrics.approvalRate > 95 ? 'text-green-400' : metrics.approvalRate > 85 ? 'text-yellow-400' : 'text-red-400'}
      />
      <StatCard
        label="Fraud Flag Rate"
        value={`${metrics.fraudFlagRate.toFixed(1)}%`}
        color={metrics.fraudFlagRate < 5 ? 'text-green-400' : metrics.fraudFlagRate < 15 ? 'text-yellow-400' : 'text-red-400'}
      />
      <StatCard
        label="P95 Latency"
        value={`${metrics.p95}ms`}
        sub={`p50: ${metrics.p50}ms · p99: ${metrics.p99}ms`}
        color={metrics.p95 < 200 ? 'text-green-400' : metrics.p95 < 500 ? 'text-yellow-400' : 'text-red-400'}
      />
    </div>
  )
}
