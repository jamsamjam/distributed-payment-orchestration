'use client'

import type { Transaction } from '@/app/page'

interface Props {
  transactions: Transaction[]
}

function StatusPill({ status }: { status: string }) {
  let bg = 'rgba(79, 159, 120, 0.10)'
  let color = 'var(--text-2)'

  if (status === 'SETTLED') {
    bg = 'var(--ok-bg)'
    color = 'var(--ok)'
  } else if (status === 'FAILED' || status === 'BLOCKED') {
    bg = 'var(--err-bg)'
    color = 'var(--err)'
  } else if (status === 'FRAUD_CHECKED' || status === 'FLAG') {
    bg = 'var(--warn-bg)'
    color = 'var(--warn)'
  } else if (status === 'INITIATED' || status === 'ROUTED') {
    bg = 'var(--info-bg)'
    color = 'var(--info)'
  }

  return (
    <span className="pill mono" style={{ background: bg, color }}>
      {status.toLowerCase()}
    </span>
  )
}

function FraudBadge({ score, decision }: { score?: number; decision?: string }) {
  if (score === undefined) return <span style={{ color: 'var(--text-3)' }}>-</span>

  const color =
    decision === 'BLOCK' ? 'var(--err)' : decision === 'FLAG' ? 'var(--warn)' : 'var(--ok)'

  return (
    <span className="mono" style={{ color, fontWeight: 700 }}>
      {score}
    </span>
  )
}

export default function TransactionFeed({ transactions }: Props) {
  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <p className="panel-title">Transaction activity</p>
          <p className="panel-subtitle">Recent payment events with routing and fraud outcomes</p>
        </div>
        <span className="soft-chip">{transactions.length} events</span>
      </div>

      <div className="table-wrap scrollbar-thin">
        {transactions.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: '13px', padding: '30px', textAlign: 'center' }}>
            Waiting for transactions...
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Fraud</th>
                <th>Provider</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn, i) => {
                const p = txn.payload
                const displayStatus = p.status ?? txn.type.replace('TRANSACTION_', '')

                return (
                  <tr key={`${txn.transactionId}-${i}`} className="data-row">
                    <td className="mono" style={{ color: 'var(--text-2)' }}>
                      {txn.transactionId.substring(0, 8)}
                    </td>
                    <td className="mono">
                      {p.amount?.toFixed(2)}{' '}
                      <span style={{ color: 'var(--text-3)' }}>{p.currency}</span>
                    </td>
                    <td>
                      <StatusPill status={displayStatus} />
                    </td>
                    <td>
                      <FraudBadge score={p.fraudScore} decision={p.fraudDecision} />
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{p.provider ?? '-'}</td>
                    <td className="mono" style={{ color: 'var(--text-3)' }}>
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