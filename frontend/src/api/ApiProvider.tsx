import type { ReactNode } from 'react'
import { ApiContext } from './context'
import type { ApiMode } from './index'
import type { Api } from './types'

export function ApiProvider({ api, mode, children }: { api: Api; mode: ApiMode; children: ReactNode }) {
  return <ApiContext.Provider value={{ api, mode }}>{children}</ApiContext.Provider>
}
