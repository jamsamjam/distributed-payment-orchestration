'use client'

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

interface DataPoint {
  ts: string
  p50: number
  p95: number
  p99: number
}

interface Props {
  history: DataPoint[]
}

export default function LatencyChart({ history }: Props) {
  const labels = history.map(h => new Date(h.ts).toLocaleTimeString())

  const data = {
    labels,
    datasets: [
      {
        label: 'P50',
        data: history.map(h => h.p50),
        borderColor: '#5da87d',
        backgroundColor: 'rgba(93, 168, 125, 0.10)',
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
        fill: false,
      },
      {
        label: 'P95',
        data: history.map(h => h.p95),
        borderColor: '#97e6d6',
        backgroundColor: 'rgba(124, 185, 173, 0.10)',
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
        fill: false,
      },
      {
        label: 'P99',
        data: history.map(h => h.p99),
        borderColor: '#d59473',
        backgroundColor: 'rgba(213, 148, 115, 0.10)',
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
        fill: false,
      },
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 240 },
    scales: {
      x: {
        grid: { color: 'rgba(116, 148, 123, 0.10)' },
        ticks: {
          color: '#7e9988',
          font: { size: 10, family: 'ui-monospace, monospace' },
          maxTicksLimit: 8,
        },
        border: { color: 'rgba(116, 148, 123, 0.18)' },
      },
      y: {
        grid: { color: 'rgba(116, 148, 123, 0.10)' },
        ticks: {
          color: '#7e9988',
          font: { size: 10, family: 'ui-monospace, monospace' },
          callback: value => `${value}ms`,
        },
        border: { color: 'rgba(116, 148, 123, 0.18)' },
        min: 0,
      },
    },
    plugins: {
      legend: {
        labels: {
          color: '#507060',
          font: { size: 11, family: 'Inter, sans-serif' },
          boxWidth: 12,
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 18,
        },
      },
      title: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(116, 148, 123, 0.18)',
        borderWidth: 1,
        titleColor: '#163126',
        bodyColor: '#507060',
        titleFont: { size: 11 },
        bodyFont: { size: 11, family: 'ui-monospace, monospace' },
      },
    },
  }

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <p className="panel-title">Latency trend</p>
          <p className="panel-subtitle">Rolling 60 second performance window</p>
        </div>
        <span className="soft-chip">Streaming</span>
      </div>

      <div style={{ padding: '18px 20px', height: '280px' }}>
        {history.length < 2 ? (
          <div
            style={{
              height: '100%',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--text-3)',
              fontSize: '13px',
            }}
          >
            Collecting latency data...
          </div>
        ) : (
          <Line data={data} options={options} />
        )}
      </div>
    </div>
  )
}