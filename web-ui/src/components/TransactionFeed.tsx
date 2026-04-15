'use client'

import type { Transaction } from '@/app/page'
import { clsx } from 'clsx'

interface Props { transactions: Transaction[] }

function StatusBadge({ status }: { status: string }) {
  const cls = clsx('px-2 py-0.5 rounded text-xs font-semibold', {
    'bg-green-900 text-green-300': status === 'SETTLED',
    'bg-yellow-900 text-yellow-300': status === 'FRAUD_CHECKED' || status === 'FLAG',
    'bg-red-900 text-red-300': status === 'FAILED' || status === 'BLOCKED',
    'bg-blue-900 text-blue-300': status === 'INITIATED' || status === 'ROUTED',
    'bg-slate-700 text-slate-300': !['SETTLED', 'FRAUD_CHECKED', 'FLAG', 'FAILED', 'BLOCKED', 'INITIATED', 'ROUTED'].includes(status),
  })
  return <span className={cls}>{status}</span>
}

function FraudBadge({ score, decision }: { score?: number; decision?: string }) {
  if (score === undefined) return null
  const color = decision === 'BLOCK' ? 'text-red-400' : decision === 'FLAG' ? 'text-yellow-400' : 'text-green-400'
  return <span className={`text-xs ${color}`}>fraud:{score}</span>
}

export default function TransactionFeed({ transactions }: Props) {
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Live Transaction Feed</h2>
        <span className="text-xs text-slate-500">{transactions.length} events</span>
      </div>
      <div className="overflow-y-auto max-h-[640px] scrollbar-thin">
        {transactions.length === 0 ? (
          <p className="text-slate-500 text-sm p-4 text-center">Waiting for transactions...</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800 border-b border-slate-700">
              <tr className="text-slate-400 text-left">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Fraud</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn, i) => {
                const p = txn.payload
                const displayStatus = p.status ?? txn.type.replace('TRANSACTION_', '')
                return (
                  <tr key={`${txn.transactionId}-${i}`}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30 animate-fade-in">
                    <td className="px-3 py-1.5 font-mono text-slate-400">
                      {txn.transactionId.substring(0, 8)}…
                    </td>
                    <td className="px-3 py-1.5 text-slate-200">
                      {p.amount?.toFixed(2)} <span className="text-slate-500">{p.currency}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={displayStatus} />
                    </td>
                    <td className="px-3 py-1.5">
                      <FraudBadge score={p.fraudScore} decision={p.fraudDecision} />
                    </td>
                    <td className="px-3 py-1.5 text-slate-400 capitalize">{p.provider ?? '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {new Date(txn.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
