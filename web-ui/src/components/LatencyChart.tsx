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
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

interface DataPoint { ts: string; p50: number; p95: number; p99: number }
interface Props { history: DataPoint[] }

export default function LatencyChart({ history }: Props) {
  const labels = history.map(h => new Date(h.ts).toLocaleTimeString())

  const data = {
    labels,
    datasets: [
      {
        label: 'P50',
        data: history.map(h => h.p50),
        borderColor: 'rgb(52, 211, 153)',
        backgroundColor: 'rgba(52, 211, 153, 0.05)',
        tension: 0.3,
        pointRadius: 2,
        fill: false,
      },
      {
        label: 'P95',
        data: history.map(h => h.p95),
        borderColor: 'rgb(251, 191, 36)',
        backgroundColor: 'rgba(251, 191, 36, 0.05)',
        tension: 0.3,
        pointRadius: 2,
        fill: false,
      },
      {
        label: 'P99',
        data: history.map(h => h.p99),
        borderColor: 'rgb(248, 113, 113)',
        backgroundColor: 'rgba(248, 113, 113, 0.05)',
        tension: 0.3,
        pointRadius: 2,
        fill: false,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    scales: {
      x: {
        grid: { color: 'rgba(100,116,139,0.2)' },
        ticks: { color: '#94a3b8', font: { size: 10 } },
      },
      y: {
        grid: { color: 'rgba(100,116,139,0.2)' },
        ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v: number) => `${v}ms` },
        min: 0,
      },
    },
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 },
      },
      title: {
        display: false,
      },
    },
  } as const

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200">Latency — 60s Rolling Window</h2>
      </div>
      <div className="p-4" style={{ height: 220 }}>
        {history.length < 2 ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Collecting latency data...
          </div>
        ) : (
          <Line data={data} options={options} />
        )}
      </div>
    </div>
  )
}
