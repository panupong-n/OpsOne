import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import App from './App.tsx'
import { ConfirmHost } from './components/ui/confirm'
import { installReadOnlyGuard } from './lib/readOnlyGuard'
import { syncHolidaysFromServer } from './lib/holidays'
import './index.css'

// Interns are read-only outside their own calendar — install the single
// client-side write guard before the app mounts.
installReadOnlyGuard(msg => toast.error(msg))

// Pull the authoritative Thai holiday list (server syncs it daily). Renders use
// the cached/fallback map until this resolves, then re-render automatically.
syncHolidaysFromServer()

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-right" richColors closeButton duration={4000} />
      <ConfirmHost />
    </QueryClientProvider>
  </React.StrictMode>,
)
