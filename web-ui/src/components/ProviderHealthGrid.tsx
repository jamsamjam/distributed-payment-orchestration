'use client'

import type { ProviderHealth } from '@/app/page'

interface Props {
  health: ProviderHealth
}

function CircuitBadge({ state }: { state: string }) {
  let color = 'var(--text-2)'
  let bg = 'rgba(79, 159, 120, 0.10)'

  if (state === 'CLOSED') {
    color = 'var(--ok)'
    bg = 'var(--ok-bg)'
  } else if (state === 'OPEN') {
    color = 'var(--err)'
    bg = 'var(--err-bg)'
  } else if (state === 'HALF_OPEN') {
    color = 'var(--warn)'
    bg = 'var(--warn-bg)'
  }

  const label = state === 'CLOSED' ? 'Healthy' : state === 'HALF_OPEN' ? 'Half-open' : 'Open'

  return (
    <span
      className="pill mono"
      style={{
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  )
}

const PROVIDERS = ['stripe', 'adyen', 'braintree']

export default function ProviderHealthGrid({ health }: Props) {
  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <p className="panel-title">Provider health</p>
          <p className="panel-subtitle">Circuit state and request quality by provider</p>
        </div>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {PROVIDERS.map(name => {
          const p = health[name]
          return (
            <div key={name} className="control-card" style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="control-title" style={{ textTransform: 'capitalize', flex: '0 0 64px' }}>
                  {name}
                </span>
                <CircuitBadge state={p?.circuitState ?? 'CLOSED'} />
                <span style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: '11px', color: (p?.successRate ?? 1) > 0.95 ? 'var(--ok)' : 'var(--warn)', fontWeight: 600 }}>
                  {p ? `${(p.successRate * 100).toFixed(1)}%` : '—'}
                </span>
                <span style={{ color: 'var(--border-strong)', fontSize: '10px' }}>·</span>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--text-2)', fontWeight: 600 }}>
                  {p ? `${Math.round(p.avgLatencyMs)}ms` : '—'}
                </span>
                <span style={{ color: 'var(--border-strong)', fontSize: '10px' }}>·</span>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                  {p?.totalRequests ?? 0} req
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}