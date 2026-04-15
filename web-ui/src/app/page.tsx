'use client'

import { useEffect, useRef, useState } from 'react'
import TransactionFeed from '@/components/TransactionFeed'
import MetricsStrip from '@/components/MetricsStrip'
import ProviderHealthGrid from '@/components/ProviderHealthGrid'
import LatencyChart from '@/components/LatencyChart'
import FailureInjector from '@/components/FailureInjector'
import TestPaymentPanel from '@/components/TestPaymentPanel'

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

// API calls go through Next.js rewrite proxy (same origin)
// SSE connects directly to the gateway to avoid Next.js buffering the stream
const API_BASE = ''
const SSE_URL = typeof window !== 'undefined'
  ? `http://${window.location.hostname}:3000/stream/transactions`
  : '/stream/transactions'

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [metrics, setMetrics] = useState<Metrics>({
    tps: 0, approvalRate: 100, fraudFlagRate: 0,
    p50: 0, p95: 0, p99: 0, revenueByProvider: {}, totalTransactions: 0,
  })
  const [providerHealth, setProviderHealth] = useState<ProviderHealth>({})
  const [latencyHistory, setLatencyHistory] = useState<{ ts: string; p50: number; p95: number; p99: number }[]>([])
  const [connected, setConnected] = useState(false)
  const sseRef = useRef<EventSource | null>(null)

  // SSE connection for live events + metrics snapshots
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

      es.onmessage = (e) => {
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

          if (['SETTLED', 'TRANSACTION_FAILED', 'ROUTED', 'FRAUD_SCORED', 'TRANSACTION_INITIATED'].includes(event.type)) {
            setTransactions(prev => [event, ...prev].slice(0, 100))
          }
        } catch {}
      }
    }

    connect()
    return () => es?.close()
  }, [])

  // Poll provider health every 3s
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
    <div className="min-h-screen bg-slate-900 p-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          <span className="text-neutral-400">Pulse</span>Pay
          <span className="text-slate-400 text-sm ml-3 font-normal">Live Operations</span>
        </h1>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs text-slate-400">{connected ? 'Live' : 'Reconnecting...'}</span>
        </div>
      </header>

      {/* Metrics Strip */}
      <MetricsStrip metrics={metrics} />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2">
          <TransactionFeed transactions={transactions} />
        </div>
        <div className="flex flex-col gap-4">
          <TestPaymentPanel />
          <ProviderHealthGrid health={providerHealth} />
          <FailureInjector />
        </div>
      </div>

      {/* Latency Chart */}
      <div className="mt-4">
        <LatencyChart history={latencyHistory} />
      </div>
    </div>
  )
}
