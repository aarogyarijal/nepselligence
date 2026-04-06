'use client'

import { createContext, useContext } from 'react'

export interface MarketStatusContext {
  isOpen: boolean
  lastUpdated: string | null
}

export const MarketStatusCtx = createContext<MarketStatusContext>({
  isOpen: false,
  lastUpdated: null,
})

export function useMarketStatus(): MarketStatusContext {
  return useContext(MarketStatusCtx)
}
