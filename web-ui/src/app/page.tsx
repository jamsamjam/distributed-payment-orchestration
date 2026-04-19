'use client'

import { useEffect, useRef, useState } from 'react'
import TransactionFeed from '@/components/TransactionFeed'
import ProviderHealthGrid from '@/components/ProviderHealthGrid'
import LatencyChart from '@/components/LatencyChart'
import FailureInjector from '@/components/FailureInjector'
import TestPaymentPanel from '@/components/TestPaymentPanel'
import PayCard from '@/components/PayCard'

type RightTab = 'test' | 'providers'

const RIGHT_TABS: { id: RightTab; label: string }[] = [
  { id: 'test', label: 'Simulation' },
  { id: 'providers', label: 'Provider' },
]

export interface Transaction {
  transactionId: string
  type: string
  timestamp: string
  payload: {
    status: string
    amount: number
    currency: string
    merchantId: string
    fraudScore?: number
    fraudDecision?: string
    provider?: string
    latencyMs?: number
  }
}

export interface Metrics {
  tps: number
  approvalRate: number
  fraudFlagRate: number
  p50: number
  p95: number
  p99: number
  revenueByProvider: Record<string, number>
  totalTransactions: number
}

export interface ProviderHealth {
  [name: string]: {
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    successRate: number
    avgLatencyMs: number
    totalRequests: number
  }
}

const API_BASE = ''
const SSE_URL =
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:3000/stream/transactions`
    : '/stream/transactions'


function TopSummary({
  metrics,
  connected,
}: {
  metrics: Metrics
  connected: boolean
}) {
  const routedVolume = Object.values(metrics.revenueByProvider ?? {}).reduce(
    (sum, value) => sum + value,
    0
  )

  return (
    <div className="hero-shell">
      <div className="hero-copy">
        <div className="eyebrow-row">
          <span className={`dot${connected ? ' dot-live' : ''}`} style={{ background: connected ? '#0fd90f' : '#d9310f' }} />
          <span>{connected ? 'Realtime monitor active' : 'Reconnecting stream'}</span>
        </div>

        <h1 className="hero-title">PulsePay</h1>

        <div className="hero-metrics">
          <div className="hero-metric-card">
            <span className="metric-label">Net volume</span>
            <span className="metric-value">${Math.round(routedVolume).toLocaleString()}</span>
          </div>
          <div className="hero-metric-card">
            <span className="metric-label">Approval rate</span>
            <span className="metric-value" style={{ color: metrics.approvalRate > 95 ? 'var(--ok)' : metrics.approvalRate > 85 ? 'var(--warn)' : 'var(--err)' }}>
              {metrics.approvalRate.toFixed(1)}%
            </span>
          </div>
          <div className="hero-metric-card">
            <span className="metric-label">Fraud flag rate</span>
            <span className="metric-value" style={{ color: metrics.fraudFlagRate < 5 ? 'var(--ok)' : metrics.fraudFlagRate < 15 ? 'var(--warn)' : 'var(--err)' }}>
              {metrics.fraudFlagRate.toFixed(1)}%
            </span>
          </div>
          <div className="hero-metric-card">
            <span className="metric-label">P95 latency</span>
            <span className="metric-value" style={{ color: metrics.p95 < 200 ? 'var(--ok)' : metrics.p95 < 500 ? 'var(--warn)' : 'var(--err)' }}>
              {metrics.p95}ms
            </span>
          </div>
        </div>
      </div>

      <div className="hero-aside">
        <PayCard />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [metrics, setMetrics] = useState<Metrics>({
    tps: 0,
    approvalRate: 100,
    fraudFlagRate: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    revenueByProvider: {},
    totalTransactions: 0,
  })
  const [providerHealth, setProviderHealth] = useState<ProviderHealth>({})
  const [latencyHistory, setLatencyHistory] = useState<
    { ts: string; p50: number; p95: number; p99: number }[]
  >([])
  const [connected, setConnected] = useState(false)
  const [rightTab, setRightTab] = useState<RightTab>('test')
  const sseRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let es: EventSource

    const connect = () => {
      es = new EventSource(SSE_URL)
      sseRef.current = es

      es.onopen = () => setConnected(true)

      es.onerror = () => {
        setConnected(false)
        setTimeout(connect, 3000)
      }

      es.onmessage = e => {
        try {
          const event = JSON.parse(e.data)

          if (event.type === 'METRICS_SNAPSHOT') {
            const p = event.payload
            setMetrics({
              tps: p.tps,
              approvalRate: p.approvalRate,
              fraudFlagRate: p.fraudFlagRate,
              p50: p.p50,
              p95: p.p95,
              p99: p.p99,
              revenueByProvider: p.revenueByProvider ?? {},
              totalTransactions: p.totalTransactions,
            })
            setLatencyHistory(prev =>
              [...prev, { ts: event.timestamp, p50: p.p50, p95: p.p95, p99: p.p99 }].slice(-20)
            )
            return
          }

          if (
            ['SETTLED', 'TRANSACTION_FAILED', 'ROUTED', 'FRAUD_SCORED', 'TRANSACTION_INITIATED'].includes(
              event.type
            )
          ) {
            // Merge by transactionId: keep one row per transaction showing its latest
            // status. Without this, each transaction generates 3-4 events that all
            // appear as separate rows and the velocity attack (48 events) buries
            // blocked transactions entirely.
            setTransactions(prev => {
              const filtered = prev.filter(t => t.transactionId !== event.transactionId)
              return [event, ...filtered].slice(0, 100)
            })
          }
        } catch {}
      }
    }

    connect()
    return () => es?.close()
  }, [])

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/providers/health`, {
          headers: { 'X-Api-Key': 'dev-api-key-12345' },
        })
        if (res.ok) setProviderHealth(await res.json())
      } catch {}
    }

    fetchHealth()
    const id = setInterval(fetchHealth, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="dashboard-page-full">
      <main className="content-shell">
        <TopSummary metrics={metrics} connected={connected} />

        <div className="content-grid">
          <div className="content-main">
            <TransactionFeed transactions={transactions} />
            <LatencyChart history={latencyHistory} />
          </div>

          <div className="content-side">
            <div className="panel-card">
              <div className="right-tab-bar">
                {RIGHT_TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setRightTab(t.id)}
                    className={`right-tab-btn${rightTab === t.id ? ' active' : ''}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="right-tab-content">
                {rightTab === 'test' && <TestPaymentPanel />}
                {rightTab === 'providers' && (
                  <>
                    <ProviderHealthGrid health={providerHealth} />
                    <FailureInjector />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}