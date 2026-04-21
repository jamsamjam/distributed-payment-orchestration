'use client'

import { useRef, useState } from 'react'

interface Result {
  status: string
  fraudScore?: number
  fraudDecision?: string
  errorMessage?: string
}

const statusColor = (s?: string) =>
  s === 'SETTLED' ? 'var(--ok)' : s === 'BLOCKED' ? 'var(--err)' : s === 'FAILED' ? 'var(--warn)' : 'var(--info)'

export default function PayCard() {
  const [amount, setAmount] = useState('50.00')
  const [country, setCountry] = useState('US')
  const [cardLast4, setCardLast4] = useState('4242')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [hovered, setHovered] = useState(false)
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const pay = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'dev-api-key-12345' },
        body: JSON.stringify({
          idempotencyKey: `card-${Date.now()}`,
          amount: parseFloat(amount) || 10,
          currency: 'USD',
          merchantId: 'merchant_demo',
          cardLast4: cardLast4.replace(/\s/g, '').slice(-4) || '0000',
          cardCountry: country || 'US',
        }),
      })
      setResult(await res.json())
    } catch (e) {
      setResult({ status: 'ERROR', errorMessage: String(e) })
    } finally {
      setLoading(false)
    }
  }

  const handlePlusClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top, key: Date.now() })
    pay()
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        ref={cardRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          borderRadius: '18px',
          padding: '20px 20px 18px',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 14px 36px rgba(45,106,79,0.28)',
          color: 'white',
        }}
      >
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #2A2D2D 50%, #353838 60%, #030504 100%)',
          pointerEvents: 'none',
        }} />

        {ripple && (
          <div
            key={ripple.key}
            onAnimationEnd={() => setRipple(null)}
            style={{
              position: 'absolute',
              left: ripple.x,
              top: ripple.y,
              transform: 'translate(-50%, -50%)',
              width: 0,
              height: 0,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(82,183,136,0.72) 0%, rgba(45,106,79,0.55) 45%, transparent 70%)',
              animation: 'card-ripple 0.68s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
              pointerEvents: 'none',
              zIndex: 4,
            }}
          />
        )}

        {hovered && !loading && (
          <button
            onClick={handlePlusClick}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              width: '26px',
              height: '26px',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.28)',
              color: 'white',
              fontSize: '16px',
              lineHeight: '1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 5,
              backdropFilter: 'blur(6px)',
              padding: 0,
              transition: 'background 0.15s',
            }}
          >
            →
          </button>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px', position: 'relative', zIndex: 1 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.65 }}>
            <path d="M8.5 12a3.5 3.5 0 0 1 3.5-3.5" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
            <path d="M6 12a6 6 0 0 1 6-6" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
            <path d="M12 12h.01" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>

        <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 500, letterSpacing: '0.06em', opacity: 0.88, position: 'relative', zIndex: 1 }}>
          Credit Card
        </p>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '14px', position: 'relative', zIndex: 1 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '15px', fontWeight: 600, letterSpacing: '0.25em', opacity: 0.45 }}>
            **** **** ****
          </span>
          <input
            type="text"
            value={cardLast4}
            onChange={e => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            maxLength={4}
            placeholder="0000"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'white',
              caretColor: 'rgba(255,255,255,0.8)',
              fontSize: '15px',
              fontWeight: 600,
              letterSpacing: '0.25em',
              width: '52px',
              padding: 0,
              fontFamily: 'ui-monospace, monospace',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', position: 'relative', zIndex: 1 }}>
          <div>
            <p style={{ margin: '0 0 3px', fontSize: '10px', opacity: 0.6, letterSpacing: '0.05em' }}>Balance Amount</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, opacity: 0.8 }}>$</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  caretColor: 'rgba(255,255,255,0.8)',
                  fontSize: '22px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  width: '120px',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', fontSize: '11px', textAlign: 'right' }}>
            <div>
              <p style={{ margin: '0 0 2px', opacity: 0.55, letterSpacing: '0.05em' }}>ORIGIN</p>
              <input
                type="text"
                value={country}
                onChange={e => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
                placeholder="US"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  caretColor: 'rgba(255,255,255,0.8)',
                  fontSize: '11px',
                  fontWeight: 600,
                  width: '28px',
                  padding: 0,
                  textAlign: 'right',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <p style={{ margin: '0 0 2px', opacity: 0.55, letterSpacing: '0.05em' }}>EXP</p>
              <p style={{ margin: 0, fontWeight: 600 }}>12/26</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
