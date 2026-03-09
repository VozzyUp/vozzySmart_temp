/**
 * POST /api/meta/coexistence/connect
 *
 * Processa o callback do Meta Embedded Signup de Coexistência.
 * Recebe o code retornado pelo FB.login(), troca por access_token,
 * busca detalhes do número e salva as credenciais no Supabase.
 *
 * Body: { code: string, phone_number_id: string, waba_id: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { fetchWithTimeout, safeJson } from '@/lib/server-http'
import { getVerifyToken } from '@/lib/verify-token'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

function computeWebhookUrl(): string {
  const vercelEnv = process.env.VERCEL_ENV || null
  if (vercelEnv === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}/api/webhook`
  } else if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.trim()}/api/webhook`
  } else if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL.trim()}/api/webhook`
  }
  return 'http://localhost:3000/api/webhook'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
    }

    const { code, phone_number_id, waba_id } = body as {
      code?: string
      phone_number_id?: string
      waba_id?: string
    }

    if (!code || !phone_number_id || !waba_id) {
      return NextResponse.json(
        { ok: false, error: 'Parâmetros obrigatórios: code, phone_number_id, waba_id' },
        { status: 400 }
      )
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID || ''
    const appSecret = process.env.META_APP_SECRET || ''

    if (!appId || !appSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: 'App Meta não configurado. Defina NEXT_PUBLIC_META_APP_ID e META_APP_SECRET no .env.',
        },
        { status: 500 }
      )
    }

    // 1. Trocar code por access_token
    const tokenUrl =
      `https://graph.facebook.com/oauth/access_token` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&code=${encodeURIComponent(code)}`

    const tokenResponse = await fetchWithTimeout(tokenUrl, {
      method: 'GET',
      cache: 'no-store',
      timeoutMs: 10000,
    })

    if (!tokenResponse.ok) {
      const errData = await safeJson<{ error?: { message?: string } }>(tokenResponse)
      const msg = errData?.error?.message || 'Falha ao trocar code por access_token'
      return NextResponse.json({ ok: false, error: msg }, { status: 400 })
    }

    const tokenData = await safeJson<{ access_token?: string; token_type?: string }>(tokenResponse)
    const accessToken = tokenData?.access_token

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: 'access_token não retornado pela Meta' },
        { status: 400 }
      )
    }

    // 2. Buscar detalhes do número para salvar display_phone_number e verified_name
    const phoneDetailsUrl =
      `${META_API_BASE}/${phone_number_id}` +
      `?fields=display_phone_number,verified_name,quality_rating,coexistence_enabled`

    const phoneResponse = await fetchWithTimeout(phoneDetailsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      timeoutMs: 10000,
    })

    let displayPhoneNumber: string | undefined
    let verifiedName: string | undefined
    let coexistenceEnabled = false

    if (phoneResponse.ok) {
      const phoneData = await safeJson<{
        display_phone_number?: string
        verified_name?: string
        coexistence_enabled?: boolean
      }>(phoneResponse)
      displayPhoneNumber = phoneData?.display_phone_number
      verifiedName = phoneData?.verified_name
      coexistenceEnabled = phoneData?.coexistence_enabled === true
    }

    // 3. Salvar credenciais no Supabase
    await settingsDb.saveAll({
      phoneNumberId: phone_number_id,
      businessAccountId: waba_id,
      accessToken,
      isConnected: true,
    })

    if (displayPhoneNumber) await settingsDb.set('displayPhoneNumber', displayPhoneNumber)
    if (verifiedName) await settingsDb.set('verifiedName', verifiedName)
    await settingsDb.set('coexistenceEnabled', coexistenceEnabled ? 'true' : 'false')

    // 4. Assinar webhooks de coexistência no WABA
    try {
      const verifyToken = await getVerifyToken()
      const webhookUrl = computeWebhookUrl()

      if (!webhookUrl.includes('localhost')) {
        const form = new URLSearchParams()
        form.set(
          'subscribed_fields',
          'messages,message_echoes,smb_message_echoes,history,smb_app_state_sync'
        )
        form.set('override_callback_uri', webhookUrl)
        form.set('verify_token', verifyToken)

        await fetchWithTimeout(`${META_API_BASE}/${waba_id}/subscribed_apps`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          cache: 'no-store',
          timeoutMs: 12000,
        })
      }
    } catch (webhookError) {
      // Best-effort: não falha a operação principal se o webhook não puder ser assinado
      console.warn('[Coexistence] Falha ao assinar webhooks de coexistência (best-effort):', webhookError)
    }

    return NextResponse.json({
      ok: true,
      phoneNumberId: phone_number_id,
      businessAccountId: waba_id,
      displayPhoneNumber,
      verifiedName,
      coexistenceEnabled,
      message: 'Coexistência configurada com sucesso!',
    })
  } catch (error) {
    console.error('[Coexistence] Erro ao processar conexão:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
