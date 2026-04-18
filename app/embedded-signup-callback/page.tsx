'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function CallbackContent() {
  const params = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')

  useEffect(() => {
    const code = params.get('code')
    const error = params.get('error')
    const origin = window.location.origin

    if (code) {
      // 1. Tenta postMessage (funciona quando opener não foi nulificado)
      try {
        window.opener?.postMessage({ type: 'embedded_signup_code', code }, origin)
      } catch {}

      // 2. Fallback: localStorage (lido pelo EmbeddedSignupButton via polling)
      try {
        localStorage.setItem('embedded_signup_code', JSON.stringify({ code, ts: Date.now() }))
      } catch {}

      setStatus('done')
    } else if (error) {
      try {
        window.opener?.postMessage({ type: 'embedded_signup_error', error }, origin)
        localStorage.setItem('embedded_signup_code', JSON.stringify({ error, ts: Date.now() }))
      } catch {}
      setStatus('error')
    } else {
      setStatus('error')
    }

    const t = setTimeout(() => window.close(), 800)
    return () => clearTimeout(t)
  }, [params])

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center space-y-3">
        {status === 'loading' && (
          <>
            <div className="h-8 w-8 mx-auto rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            <p className="text-sm text-zinc-400">Conectando à Meta...</p>
          </>
        )}
        {status === 'done' && (
          <>
            <div className="h-8 w-8 mx-auto text-emerald-400 text-2xl">✓</div>
            <p className="text-sm text-zinc-400">Conexão concluída. Fechando...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="h-8 w-8 mx-auto text-red-400 text-2xl">✕</div>
            <p className="text-sm text-zinc-400">Erro na conexão. Feche esta janela.</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function EmbeddedSignupCallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  )
}
