'use client'

import { useState } from 'react'

const PROVIDERS = ['stripe', 'adyen', 'braintree']
const DURATIONS = ['10s', '30s', '60s', '2m']

export default function FailureInjector() {
  const [injecting, setInjecting] = useState<string | null>(null)
  const [duration, setDuration] = useState('30s')
  const [log, setLog] = useState<string[]>([])

  const inject = async (provider: string) => {
    setInjecting(provider)
    try {
      const res = await fetch(
        `/api/v1/admin/inject-failure?provider=${provider}&duration=${duration}`,
        {
          method: 'POST',
          headers: { 'X-Api-Key': 'dev-api-key-12345' },
        }
      )

      const ts = new Date().toLocaleTimeString()

      if (res.ok) {
        setLog(prev => [`${ts} injected ${duration} into ${provider}`, ...prev].slice(0, 10))
      } else {
        setLog(prev => [`${ts} failed: ${provider}`, ...prev].slice(0, 10))
      }
    } catch (e) {
      setLog(prev => [`${new Date().toLocaleTimeString()} error: ${e}`, ...prev].slice(0, 10))
    } finally {
      setInjecting(null)
    }
  }

  const recoverAll = async () => {
    try {
      await fetch('/api/v1/admin/recover', {
        method: 'POST',
        headers: { 'X-Api-Key': 'dev-api-key-12345' },
      })
      setLog(prev => [`${new Date().toLocaleTimeString()} all providers recovered`, ...prev].slice(0, 10))
    } catch {}
  }

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <p className="panel-title">Failure controls</p>
          <p className="panel-subtitle">Trigger provider failures for demos and recovery tests</p>
        </div>
      </div>

      <div className="control-stack">
        <div className="control-card">
          <p className="control-title">Inject by provider</p>

          <div className="inline-grid" style={{ marginTop: '15px' }}>
            {DURATIONS.map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={duration === d ? 'action-button accent' : 'action-button'}
              >
                {d}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
            {PROVIDERS.map(p => (
              <button
                key={p}
                onClick={() => inject(p)}
                disabled={injecting === p}
                className="action-button danger"
                style={{ width: '100%', textAlign: 'left' }}
              >
                {injecting === p ? `Injecting ${p}...` : `Fail ${p} for ${duration}`}
              </button>
            ))}
          </div>
        </div>

        <button onClick={recoverAll} className="action-button success" style={{ width: '100%' }}>
          Recover all providers
        </button>

        {log.length > 0 && (
          <div className="control-card">
            <p className="control-title">Activity log</p>
            <div
              className="mono scrollbar-thin"
              style={{
                marginTop: '10px',
                maxHeight: '120px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '11px',
                color: 'var(--text-2)',
              }}
            >
              {log.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}