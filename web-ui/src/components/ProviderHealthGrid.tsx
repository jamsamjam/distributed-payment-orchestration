'use client'

import type { ProviderHealth } from '@/app/page'
import { clsx } from 'clsx'

interface Props { health: ProviderHealth }

function CircuitBadge({ state }: { state: string }) {
  const cls = clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold', {
    'bg-green-900 text-green-300': state === 'CLOSED',
    'bg-red-900 text-red-300': state === 'OPEN',
    'bg-yellow-900 text-yellow-300': state === 'HALF_OPEN',
  })
  const dot = clsx('w-1.5 h-1.5 rounded-full', {
    'bg-green-400': state === 'CLOSED',
    'bg-red-400': state === 'OPEN',
    'bg-yellow-400': state === 'HALF_OPEN',
  })
  return (
    <span className={cls}>
      <span className={dot} />
      {state}
    </span>
  )
}

const PROVIDERS = ['stripe', 'adyen', 'braintree']

export default function ProviderHealthGrid({ health }: Props) {
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200">Provider Health</h2>
      </div>
      <div className="p-3 flex flex-col gap-2">
        {PROVIDERS.map(name => {
          const p = health[name]
          return (
            <div key={name} className="bg-slate-700/50 rounded-lg p-3 border border-slate-600/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold capitalize text-slate-200">{name}</span>
                <CircuitBadge state={p?.circuitState ?? 'CLOSED'} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>Success rate</span>
                <span className={`font-mono ${(p?.successRate ?? 1) > 0.95 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {p ? `${(p.successRate * 100).toFixed(1)}%` : '—'}
                </span>
                <span>Avg latency</span>
                <span className="font-mono text-slate-300">
                  {p ? `${Math.round(p.avgLatencyMs)}ms` : '—'}
                </span>
                <span>Requests</span>
                <span className="font-mono text-slate-300">{p?.totalRequests ?? 0}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
