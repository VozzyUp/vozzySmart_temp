'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmbeddedSignupButtonProps {
  /** App ID da Meta (NEXT_PUBLIC_META_APP_ID) */
  appId: string
  /** Config ID do Embedded Signup configurado na Meta */
  configId: string
  /** Callback chamado após conexão bem-sucedida */
  onSuccess: (data: {
    phoneNumberId: string
    businessAccountId: string
    displayPhoneNumber?: string
    verifiedName?: string
  }) => void
  className?: string
}

/**
 * Abre o fluxo Meta Embedded Signup em um popup.
 *
 * Fluxo:
 * 1. Abre popup para o URL de onboarding da Meta
 * 2. Meta posta sessionInfo via window.postMessage (phone_number_id, waba_id)
 * 3. Popup redireciona para /embedded-signup-callback com ?code=...
 * 4. Callback page posta o código de volta via postMessage
 * 5. Este componente chama /api/settings/embedded-signup para trocar o código
 * 6. Chama onSuccess com os dados finais
 */
export function EmbeddedSignupButton({
  appId,
  configId,
  onSuccess,
  className,
}: EmbeddedSignupButtonProps) {
  const [status, setStatus] = useState<'idle' | 'waiting' | 'exchanging'>('idle')
  const popupRef = useRef<Window | null>(null)
  const sessionDataRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({})

  const exchangeCode = useCallback(
    async (code: string) => {
      setStatus('exchanging')
      try {
        const redirectUri = `${window.location.origin}/embedded-signup-callback`
        const res = await fetch('/api/settings/embedded-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            phoneNumberId: sessionDataRef.current.phoneNumberId || '',
            wabaId: sessionDataRef.current.wabaId || '',
            redirectUri,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || data.details || 'Falha ao conectar')
        }

        if (data.partial) {
          toast.warning('Token obtido', {
            description: 'Informe o Phone Number ID e WABA ID manualmente para concluir.',
          })
          return
        }

        toast.success('Conectado via Meta!', {
          description: data.displayPhoneNumber
            ? `${data.displayPhoneNumber}${data.verifiedName ? ` • ${data.verifiedName}` : ''}`
            : 'Credenciais salvas com sucesso.',
        })

        onSuccess({
          phoneNumberId: data.phoneNumberId,
          businessAccountId: data.businessAccountId,
          displayPhoneNumber: data.displayPhoneNumber,
          verifiedName: data.verifiedName,
        })
      } catch (err) {
        toast.error('Falha no Embedded Signup', {
          description: err instanceof Error ? err.message : 'Tente novamente',
        })
      } finally {
        setStatus('idle')
        sessionDataRef.current = {}
      }
    },
    [onSuccess]
  )

  // Escuta mensagens do popup (sessionInfo da Meta e código do callback)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Apenas aceita mensagens da mesma origem ou da Meta
      const isSameOrigin = event.origin === window.location.origin
      const isMetaOrigin =
        event.origin === 'https://www.facebook.com' ||
        event.origin === 'https://business.facebook.com'

      if (!isSameOrigin && !isMetaOrigin) return

      const msg = event.data

      // Mensagem de sessionInfo da Meta (phone_number_id, waba_id)
      if (msg?.type === 'WA_EMBEDDED_SIGNUP' && msg?.data) {
        sessionDataRef.current = {
          phoneNumberId: msg.data.phone_number_id || '',
          wabaId: msg.data.waba_id || msg.data.id || '',
        }
        return
      }

      // Código de autorização da página callback
      if (isSameOrigin && msg?.type === 'embedded_signup_code' && msg?.code) {
        exchangeCode(msg.code)
        return
      }

      // Erro retornado pelo callback
      if (isSameOrigin && msg?.type === 'embedded_signup_error') {
        toast.error('Conexão cancelada ou negada pela Meta')
        setStatus('idle')
        sessionDataRef.current = {}
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [exchangeCode])

  const handleClick = () => {
    if (status !== 'idle') return
    if (!appId || !configId) {
      toast.error('Configure o Meta App ID nas configurações primeiro')
      return
    }

    const redirectUri = encodeURIComponent(`${window.location.origin}/embedded-signup-callback`)
    const signupUrl =
      `https://business.facebook.com/messaging/whatsapp/onboard/` +
      `?app_id=${appId}` +
      `&config_id=${configId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&override_default_response_type=true`

    const width = 600
    const height = 700
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2

    popupRef.current = window.open(
      signupUrl,
      'meta_embedded_signup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
    )

    if (!popupRef.current) {
      toast.error('Popup bloqueado', {
        description: 'Permita popups para este site e tente novamente.',
      })
      return
    }

    setStatus('waiting')

    // Limpa qualquer código antigo do localStorage
    try { localStorage.removeItem('embedded_signup_code') } catch {}

    // Polling: lê código do localStorage (fallback quando window.opener é nulo)
    const pollStorage = setInterval(() => {
      try {
        const raw = localStorage.getItem('embedded_signup_code')
        if (!raw) return
        const parsed = JSON.parse(raw)
        // Ignora entradas com mais de 5 minutos
        if (Date.now() - parsed.ts > 5 * 60 * 1000) {
          localStorage.removeItem('embedded_signup_code')
          return
        }
        localStorage.removeItem('embedded_signup_code')
        clearInterval(pollStorage)
        clearInterval(checkClosed)
        if (parsed.code) {
          exchangeCode(parsed.code)
        } else {
          toast.error('Conexão cancelada ou negada pela Meta')
          setStatus('idle')
        }
      } catch {}
    }, 500)

    // Monitora se popup foi fechado sem completar
    const checkClosed = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(checkClosed)
        clearInterval(pollStorage)
        setStatus((prev) => (prev === 'waiting' ? 'idle' : prev))
      }
    }, 1000)
  }

  const isLoading = status !== 'idle'

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={isLoading || !appId || !configId}
      variant="outline"
      className={className}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {status === 'exchanging' ? 'Conectando...' : 'Aguardando Meta...'}
        </>
      ) : (
        <>
          <MetaIcon className="mr-2 h-4 w-4" />
          Conectar via Meta
        </>
      )}
    </Button>
  )
}

function MetaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-2.949 1.133-.358.277-.721.62-1.079 1.071a6.48 6.48 0 0 0-1.011-1.015C9.045 4.51 8.006 4.03 6.915 4.03zm6.674 4.579c.326-.38.682-.708 1.02-.955.618-.448 1.133-.618 1.64-.618 1.076 0 2.246.746 3.146 2.137 1.045 1.601 1.62 3.81 1.62 6.05 0 1.07-.175 1.843-.498 2.39-.185.322-.44.593-.782.753a1.933 1.933 0 0 1-.807.173c-.63 0-1.12-.197-1.853-.944-.733-.747-1.544-1.943-2.31-3.228l-2.29-3.819c.307-.598.631-1.234.98-1.812.182-.306.362-.603.534-.127zM9.18 13.368c-.735 1.32-1.086 1.878-1.652 2.617-.87 1.146-1.612 1.597-2.396 1.597-.801 0-1.506-.419-2.035-1.306a4.605 4.605 0 0 1-.28-.631 5.564 5.564 0 0 1-.226-1.64c0-2.266.626-4.676 1.684-6.32.785-1.221 1.778-1.994 2.877-1.994.69 0 1.281.272 1.853.734.315.255.63.591.942 1.013L8.77 8.93c-.528.862-.997 1.78-1.413 2.7l-.362.833-.248.567 1.06 1.844.373-.506z" />
    </svg>
  )
}
