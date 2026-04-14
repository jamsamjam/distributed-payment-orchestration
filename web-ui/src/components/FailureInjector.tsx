'use client'

import { useState } from 'react'
import { clsx } from 'clsx'

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
        setLog(prev => [`${ts} ✓ Injected ${duration} failure into ${provider}`, ...prev].slice(0, 10))
      } else {
        setLog(prev => [`${ts} ✗ Failed to inject into ${provider}`, ...prev].slice(0, 10))
      }
    } catch (e) {
      setLog(prev => [`${new Date().toLocaleTimeString()} ✗ Error: ${e}`, ...prev].slice(0, 10))
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
      setLog(prev => [`${new Date().toLocaleTimeString()} ✓ All providers recovered`, ...prev].slice(0, 10))
    } catch {}
  }

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200">Failure Injection</h2>
        <p className="text-xs text-slate-500 mt-0.5">Trip circuit breakers for demo</p>
      </div>
      <div className="p-3">
        {/* Duration selector */}
        <div className="flex gap-1 mb-3">
          {DURATIONS.map(d => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={clsx(
                'flex-1 text-xs py-1 rounded border transition-colors',
                duration === d
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              )}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Provider buttons */}
        <div className="flex flex-col gap-1.5 mb-3">
          {PROVIDERS.map(p => (
            <button
              key={p}
              onClick={() => inject(p)}
              disabled={injecting === p}
              className={clsx(
                'w-full py-1.5 px-3 rounded text-xs font-medium border transition-colors capitalize',
                injecting === p
                  ? 'opacity-50 cursor-wait border-slate-600 text-slate-500'
                  : 'border-red-700/50 text-red-400 hover:bg-red-900/30 hover:border-red-600'
              )}
            >
              {injecting === p ? 'Injecting...' : `Fail ${p} for ${duration}`}
            </button>
          ))}
        </div>

        {/* Recover button */}
        <button
          onClick={recoverAll}
          className="w-full py-1.5 text-xs rounded border border-green-700/50 text-green-400 hover:bg-green-900/20 transition-colors mb-2"
        >
          Recover All Providers
        </button>

        {/* Activity log */}
        {log.length > 0 && (
          <div className="mt-2 text-xs text-slate-500 font-mono space-y-0.5 max-h-24 overflow-y-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}
