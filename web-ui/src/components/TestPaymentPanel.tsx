'use client'

import { useState } from 'react'
import { clsx } from 'clsx'

// All scenarios share card 4242 so history accumulates across sends
const SCENARIOS = [
  {
    label: 'Normal Payment',
    description: '$99 from US — expect SETTLED',
    color: 'green',
    payload: { amount: 99.99, currency: 'USD', merchantId: 'merchant_demo', cardLast4: '4242', cardCountry: 'US' },
  },
  {
    label: 'Geo Anomaly',
    description: 'Same card, different country — send after Normal',
    color: 'yellow',
    payload: { amount: 120.00, currency: 'USD', merchantId: 'merchant_demo', cardLast4: '4242', cardCountry: 'RU' },
  },
  {
    label: 'Amount Anomaly',
    description: '$9999 — 100× deviation from $99 baseline',
    color: 'orange',
    payload: { amount: 9999.99, currency: 'USD', merchantId: 'merchant_demo', cardLast4: '4242', cardCountry: 'US' },
  },
  {
    label: 'Fraud Block',
    description: 'Large amount + geo combo — expect BLOCKED',
    color: 'red',
    payload: { amount: 9999.99, currency: 'USD', merchantId: 'merchant_demo', cardLast4: '4242', cardCountry: 'KP' },
  },
]

interface Result {
  status: string
  fraudScore?: number
  fraudDecision?: string
  provider?: string
  errorMessage?: string
}

export default function TestPaymentPanel() {
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, Result>>({})
  const [customAmount, setCustomAmount] = useState('50.00')
  const [customCountry, setCustomCountry] = useState('US')
  const [rapidCount, setRapidCount] = useState(0)

  const send = async (label: string, payload: Record<string, unknown>) => {
    setLoading(label)
    try {
      const res = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'dev-api-key-12345' },
        body: JSON.stringify({ ...payload, idempotencyKey: `ui-${label}-${Date.now()}` }),
      })
      const data = await res.json()
      setResults(prev => ({ ...prev, [label]: data }))
    } catch (e) {
      setResults(prev => ({ ...prev, [label]: { status: 'ERROR', errorMessage: String(e) } }))
    } finally {
      setLoading(null)
    }
  }

  // Fire 12 payments in quick succession to trigger HIGH_VELOCITY (>10 in 10min)
  const rapidFire = async () => {
    setLoading('Rapid')
    setRapidCount(0)
    const promises = Array.from({ length: 12 }, (_, i) =>
      fetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'dev-api-key-12345' },
        body: JSON.stringify({
          idempotencyKey: `rapid-${Date.now()}-${i}`,
          amount: 25.00,
          currency: 'USD',
          merchantId: 'merchant_demo',
          cardLast4: '4242',
          cardCountry: 'US',
        }),
      }).then(() => setRapidCount(c => c + 1))
    )
    await Promise.all(promises)
    setLoading(null)
  }

  const statusColor = (s?: string) =>
    s === 'SETTLED' ? 'text-green-400' :
    s === 'BLOCKED' ? 'text-red-400' :
    s === 'FAILED'  ? 'text-orange-400' : 'text-yellow-400'

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200">Test Payments</h2>
        <p className="text-xs text-slate-500 mt-0.5">All use card 4242 — history accumulates across sends</p>
      </div>
      <div className="p-3 space-y-2">
        {SCENARIOS.map(({ label, description, color, payload }) => {
          const result = results[label]
          const isLoading = loading === label
          return (
            <div key={label} className="bg-slate-700/50 rounded-lg p-2.5 border border-slate-600/50">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-slate-200">{label}</span>
                  <p className="text-xs text-slate-500 truncate">{description}</p>
                </div>
                <button
                  onClick={() => send(label, payload)}
                  disabled={!!loading}
                  className={clsx(
                    'shrink-0 px-3 py-1 rounded text-xs font-medium border transition-colors',
                    isLoading ? 'opacity-50 cursor-wait border-slate-600 text-slate-400' :
                    color === 'green'  ? 'border-green-700/60 text-green-400 hover:bg-green-900/30' :
                    color === 'yellow' ? 'border-yellow-700/60 text-yellow-400 hover:bg-yellow-900/30' :
                    color === 'orange' ? 'border-orange-700/60 text-orange-400 hover:bg-orange-900/30' :
                                        'border-red-700/60 text-red-400 hover:bg-red-900/30'
                  )}
                >
                  {isLoading ? '…' : 'Send'}
                </button>
              </div>
              {result && (
                <div className="mt-1.5 text-xs font-mono bg-slate-900/60 rounded px-2 py-1 flex gap-2 flex-wrap">
                  <span className={statusColor(result.status)}>{result.status}</span>
                  {result.fraudScore !== undefined && (
                    <span className="text-slate-400">score:{result.fraudScore} {result.fraudDecision}</span>
                  )}
                  {result.provider && <span className="text-slate-400">→ {result.provider}</span>}
                  {result.errorMessage && <span className="text-orange-400 truncate">{result.errorMessage}</span>}
                </div>
              )}
            </div>
          )
        })}

        {/* Rapid fire for velocity fraud */}
        <div className="bg-slate-700/50 rounded-lg p-2.5 border border-slate-600/50">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-slate-200">Velocity Attack</span>
              <p className="text-xs text-slate-500">12 rapid payments → HIGH_VELOCITY (+30 pts)</p>
            </div>
            <button
              onClick={rapidFire}
              disabled={!!loading}
              className="shrink-0 px-3 py-1 rounded text-xs font-medium border border-purple-700/60 text-purple-400 hover:bg-purple-900/30 transition-colors disabled:opacity-50"
            >
              {loading === 'Rapid' ? `${rapidCount}/12` : 'Fire'}
            </button>
          </div>
        </div>

        {/* Custom */}
        <div className="bg-slate-700/50 rounded-lg p-2.5 border border-slate-600/50">
          <p className="text-xs font-semibold text-slate-200 mb-2">Custom</p>
          <div className="flex gap-2 mb-2">
            <div className="flex-1">
              <label className="text-xs text-slate-500 block mb-0.5">Amount</label>
              <input
                type="number"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="w-16">
              <label className="text-xs text-slate-500 block mb-0.5">Country</label>
              <input
                type="text"
                value={customCountry}
                onChange={e => setCustomCountry(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 uppercase"
              />
            </div>
          </div>
          <button
            onClick={() => send('Custom', {
              amount: parseFloat(customAmount) || 10,
              currency: 'USD',
              merchantId: 'merchant_demo',
              cardLast4: '4242',
              cardCountry: customCountry || 'US',
            })}
            disabled={!!loading}
            className="w-full py-1 text-xs rounded border border-indigo-700/60 text-indigo-400 hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
          >
            {loading === 'Custom' ? 'Sending…' : 'Send'}
          </button>
          {results['Custom'] && (
            <div className="mt-1.5 text-xs font-mono bg-slate-900/60 rounded px-2 py-1 flex gap-2">
              <span className={statusColor(results['Custom'].status)}>{results['Custom'].status}</span>
              {results['Custom'].fraudScore !== undefined && (
                <span className="text-slate-400">score:{results['Custom'].fraudScore} {results['Custom'].fraudDecision}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
