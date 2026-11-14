import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { resolveApi } from './api'
import { ApiProvider } from './api/ApiProvider'
import App from './app/App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
})

// Decide between the live backend and demo data once, before the first render.
const { api, mode } = await resolveApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api} mode={mode}>
        <App />
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
)
