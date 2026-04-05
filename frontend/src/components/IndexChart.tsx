'use client'

import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface ChartData {
  time: string
  value: number
}

interface Props {
  timeRange: string
}

export default function IndexChart({ timeRange }: Props) {
  const [data, setData] = useState<ChartData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        // For MVP, use mock data
        const mockData: ChartData[] = [
          { time: '11:00', value: 2676.68 },
          { time: '11:30', value: 2680.45 },
          { time: '12:00', value: 2682.10 },
          { time: '12:30', value: 2678.90 },
          { time: '13:00', value: 2685.30 },
          { time: '13:30', value: 2687.20 },
          { time: '14:00', value: 2682.50 },
          { time: '14:30', value: 2684.10 },
          { time: '15:00', value: 2682.19 },
        ]
        setData(mockData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [timeRange])

  if (loading) {
    return <div className="text-slate-400">Loading chart...</div>
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>
  }

  const minValue = Math.min(...data.map((d) => d.value))
  const maxValue = Math.max(...data.map((d) => d.value))
  const isNegative = data[data.length - 1].value < data[0].value

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(100, 116, 139)" />
        <XAxis
          dataKey="time"
          stroke="rgb(148, 163, 184)"
          style={{ fontSize: '12px' }}
        />
        <YAxis
          domain={[minValue * 0.99, maxValue * 1.01]}
          stroke="rgb(148, 163, 184)"
          style={{ fontSize: '12px' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgb(30, 41, 59)',
            border: '1px solid rgb(100, 116, 139)',
            borderRadius: '8px',
            color: 'rgb(226, 232, 240)',
          }}
          formatter={(value: number) => value.toFixed(2)}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={isNegative ? '#ef4444' : '#10b981'}
          dot={{ fill: isNegative ? '#ef4444' : '#10b981', r: 4 }}
          isAnimationActive={false}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
