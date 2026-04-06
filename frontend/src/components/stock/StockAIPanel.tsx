'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchStockInsight, generateStockInsight, chatWithStock } from '@/lib/api'
import type { StockInsight, StockChatMessage } from '@/types/market'

interface Props {
  symbol: string
}

function formatNPT(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kathmandu',
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

export default function StockAIPanel({ symbol }: Props) {
  const [insight, setInsight] = useState<StockInsight | null>(null)
  const [generating, setGenerating] = useState(false)
  const [messages, setMessages] = useState<StockChatMessage[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load cached insight on mount
  useEffect(() => {
    fetchStockInsight(symbol).then(data => {
      if (data) setInsight(data)
    })
    setMessages([])
    setInput('')
    setError(null)
  }, [symbol])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatLoading])

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const data = await generateStockInsight(symbol)
      setInsight(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate insight')
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || chatLoading) return

    const userMsg: StockChatMessage = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setChatLoading(true)
    setError(null)

    try {
      const reply = await chatWithStock(symbol, next)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat request failed')
    } finally {
      setChatLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col">
      {/* Top: AI Analysis */}
      <div className="p-5 border-b border-slate-700/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              AI Analysis
            </h3>
            <span className="text-xs px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded">
              Claude
            </span>
            {insight && (
              <span className="text-xs text-slate-600">
                {formatNPT(insight.generated_at)} NPT
              </span>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            {generating ? (
              <>
                <span className="inline-block w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>↻ {insight ? 'Regenerate' : 'Generate Insight'}</>
            )}
          </button>
        </div>

        {generating ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-3.5 bg-slate-700 rounded w-full" />
            <div className="h-3.5 bg-slate-700 rounded w-5/6" />
            <div className="h-3.5 bg-slate-700 rounded w-4/6" />
            <div className="h-3.5 bg-slate-700 rounded w-full mt-2" />
            <div className="h-3.5 bg-slate-700 rounded w-3/4" />
          </div>
        ) : insight ? (
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
            {insight.insight_text}
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Generate an AI analysis of {symbol} based on current technical data.
          </p>
        )}
      </div>

      {/* Bottom: Chat */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-5 py-2.5 border-b border-slate-700/60 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Ask Claude about {symbol}
          </span>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Message history */}
        {messages.length > 0 && (
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 max-h-72">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-800/60 text-blue-100'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 px-3 py-2 rounded-lg">
                  <span className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-5 my-2 px-3 py-2 bg-red-900/30 border border-red-700/40 rounded text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="p-4 flex gap-2 items-end border-t border-slate-700/60">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${symbol} — entry points, technicals, comparisons...`}
            rows={2}
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatLoading}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
