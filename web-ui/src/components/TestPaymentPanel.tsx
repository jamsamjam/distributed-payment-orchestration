'use client'

import { useState } from 'react'
import { clsx } from 'clsx'

const SCENARIOS = [
  {
    label: 'Normal Payment',
    description: '$99 from US',
    tone: 'green',
    payload: {
      amount: 99.99,
      currency: 'USD',
      merchantId: 'merchant_demo',
      cardLast4: '4242',
      cardCountry: 'US',
    },
  },
  {
    label: 'Geo Anomaly',
    description: 'US $99 baseline → FR $700 spike',
    tone: 'yellow',
    // Seeds a US baseline ($99.99) first, then fires from FR at $700 (~7× baseline).
    // geo(+30) + amount_extreme(+55) = 85 → BLOCK (threshold > 80).
    payload: {
      amount: 700.0,
      currency: 'USD',
      merchantId: 'merchant_demo',
      cardLast4: '4243',
      cardCountry: 'FR',
    },
    // baseline sent before the real payload
    baseline: {
      amount: 99.99,
      currency: 'USD',
      merchantId: 'merchant_demo',
      cardLast4: '4243',
      cardCountry: 'US',
    },
  },
  {
    label: 'Amount Anomaly',
    description: 'US baseline → 100× amount spike',
    tone: 'orange',
    payload: {
      amount: 9999.99,
      currency: 'USD',
      merchantId: 'merchant_demo',
      cardLast4: '4244',
      cardCountry: 'US',
    },
    baseline: {
      amount: 99.99,
      currency: 'USD',
      merchantId: 'merchant_demo',
      cardLast4: '4244',
      cardCountry: 'US',
    },
  },
  {
    label: 'Fraud Block',
    description: 'US baseline → large amount + geo change',
    tone: 'red',
    payload: {
      amount: 9999.99,
      currency: 'USD',
      merchantId: 'merchant_demo',
      cardLast4: '4245',
      cardCountry: 'JP',
    },
    // Without a US baseline first: no geo signal (last_country=null) and no
    // amount baseline → score stays 0 → ALLOW. Seeding fixes both signals.
    baseline: {
      amount: 99.99,
      currency: 'USD',
      merchantId: 'merchant_demo',
      cardLast4: '4245',
      cardCountry: 'US',
    },
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
  const [rapidCount, setRapidCount] = useState(0)

  const post = (payload: Record<string, unknown>, key: string) =>
    fetch('/api/v1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'dev-api-key-12345' },
      body: JSON.stringify({ ...payload, idempotencyKey: key }),
    }).then(r => r.json())

  const send = async (label: string, payload: Record<string, unknown>, baseline?: Record<string, unknown>) => {
    setLoading(label)
    try {
      const ts = Date.now()
      // Fresh card per click: prevents history pollution where repeated test runs
      // inflate avg_amount until the anomaly threshold stops firing.
      const freshCard = String(Math.floor(1000 + Math.random() * 9000))
      const withCard = (p: Record<string, unknown>) => ({ ...p, cardLast4: freshCard })

      // Send baseline first (establishes avg_amount and last_country in fraud engine)
      // so that geo-travel and amount-deviation signals fire reliably on the real payload.
      if (baseline) {
        await post(withCard(baseline), `ui-baseline-${label}-${ts}`)
      }
      const data = await post(withCard(payload), `ui-${label}-${ts}`)
      setResults(prev => ({ ...prev, [label]: data }))
    } catch (e) {
      setResults(prev => ({
        ...prev,
        [label]: { status: 'ERROR', errorMessage: String(e) },
      }))
    } finally {
      setLoading(null)
    }
  }

  const rapidFire = async () => {
    setLoading('Rapid')
    setRapidCount(0)

    const promises = Array.from({ length: 12 }, (_, i) =>
      fetch('/api/v1/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': 'dev-api-key-12345',
        },
        body: JSON.stringify({
          idempotencyKey: `rapid-${Date.now()}-${i}`,
          amount: 25.0,
          currency: 'USD',
          merchantId: 'merchant_demo',
          cardLast4: '9999',
          cardCountry: 'US',
        }),
      }).then(() => setRapidCount(c => c + 1))
    )

    await Promise.all(promises)
    setLoading(null)
  }

  const statusColor = (s?: string) =>
    s === 'SETTLED'
      ? 'var(--ok)'
      : s === 'BLOCKED'
        ? 'var(--err)'
        : s === 'FAILED'
          ? 'var(--warn)'
          : 'var(--info)'

  const toneStyle = (tone: string) => {
    if (tone === 'green') {
      return { color: 'var(--ok)', borderColor: 'rgba(47, 140, 104, 0.22)', bg: '#f1fbf6' }
    }
    if (tone === 'yellow') {
      return { color: 'var(--warn)', borderColor: 'rgba(192, 135, 56, 0.22)', bg: '#fff9ef' }
    }
    if (tone === 'orange') {
      return { color: '#d27d43', borderColor: 'rgba(210, 125, 67, 0.22)', bg: '#fff5ef' }
    }
    return { color: 'var(--err)', borderColor: 'rgba(196, 93, 93, 0.22)', bg: '#fff4f4' }
  }

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <p className="panel-title">Test payments</p>
        </div>
        <span className="soft-chip">merchant_demo</span>
      </div>

      <div className="control-stack">
        {SCENARIOS.map(({ label, description, tone, payload, baseline }) => {
          const result = results[label]
          const isLoading = loading === label
          const style = toneStyle(tone)

          return (
            <div key={label} className="control-card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'start',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p className="control-title">{label}</p>
                  <p className="control-copy">{description}</p>
                </div>

                <button
                  onClick={() => send(label, payload, baseline)}
                  disabled={!!loading}
                  className="action-button"
                  style={{
                    color: style.color,
                    borderColor: style.borderColor,
                    background: style.bg,
                  }}
                >
                  {isLoading ? 'Sending...' : 'Run'}
                </button>
              </div>

              {result && (
                <div
                  className="mono"
                  style={{
                    marginTop: '12px',
                    padding: '10px 12px',
                    borderRadius: '14px',
                    background: 'rgba(255,255,255,0.75)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '10px',
                    fontSize: '12px',
                  }}
                >
                  <span style={{ color: statusColor(result.status), fontWeight: 700 }}>{result.status}</span>
                  {result.fraudScore !== undefined && (
                    <span style={{ color: 'var(--text-2)' }}>
                      score:{result.fraudScore} {result.fraudDecision}
                    </span>
                  )}
                  {result.provider && <span style={{ color: 'var(--text-2)' }}>provider:{result.provider}</span>}
                  {result.errorMessage && <span style={{ color: 'var(--err)' }}>{result.errorMessage}</span>}
                </div>
              )}
            </div>
          )
        })}

        <div className="control-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'start',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <p className="control-title">Velocity attack</p>
              <p className="control-copy">12 rapid payments</p>
            </div>

            <button
              onClick={rapidFire}
              disabled={!!loading}
              className="action-button"
              style={{
                color: '#7b66d6',
                borderColor: 'rgba(123, 102, 214, 0.18)',
                background: '#f6f3ff',
              }}
            >
              {loading === 'Rapid' ? `${rapidCount}/12` : 'Fire'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
