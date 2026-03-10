/**
 * POST /api/meta/coexistence/connect
 *
 * Processa o callback do Meta Embedded Signup de Coexistência.
 * Recebe o code retornado pelo FB.login(), troca por access_token,
 * busca phone_number_id via /{waba_id}/phone_numbers (coexistência não retorna no evento),
 * salva as credenciais no Supabase e dispara sincronização de contatos e histórico.
 *
 * Body: { code: string, waba_id: string, phone_number_id?: string }
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

    const { code, waba_id, phone_number_id: phoneNumberIdFromClient } = body as {
      code?: string
      waba_id?: string
      phone_number_id?: string
    }

    if (!code || !waba_id) {
      return NextResponse.json(
        { ok: false, error: 'Parâmetros obrigatórios: code, waba_id' },
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

    // 2. Resolver phone_number_id — o evento de coexistência não retorna este campo,
    //    então buscamos via /{waba_id}/phone_numbers
    let phone_number_id = phoneNumberIdFromClient && phoneNumberIdFromClient.trim()
      ? phoneNumberIdFromClient.trim()
      : null

    if (!phone_number_id) {
      const phoneNumbersUrl = `${META_API_BASE}/${waba_id}/phone_numbers?fields=id,display_phone_number,verified_name`
      const phoneNumbersResponse = await fetchWithTimeout(phoneNumbersUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        timeoutMs: 10000,
      })

      if (phoneNumbersResponse.ok) {
        const phoneNumbersData = await safeJson<{ data?: Array<{ id: string }> }>(phoneNumbersResponse)
        phone_number_id = phoneNumbersData?.data?.[0]?.id || null
      }

      if (!phone_number_id) {
        return NextResponse.json(
          { ok: false, error: 'Não foi possível obter o Phone Number ID da conta WhatsApp Business.' },
          { status: 400 }
        )
      }
    }

    // 3. Buscar detalhes do número — usa is_on_biz_app e platform_type conforme docs oficiais
    const phoneDetailsUrl =
      `${META_API_BASE}/${phone_number_id}` +
      `?fields=display_phone_number,verified_name,quality_rating,is_on_biz_app,platform_type`

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
        is_on_biz_app?: boolean
        platform_type?: string
      }>(phoneResponse)
      displayPhoneNumber = phoneData?.display_phone_number
      verifiedName = phoneData?.verified_name
      // is_on_biz_app=true + platform_type=CLOUD_API indica coexistência ativa
      coexistenceEnabled =
        phoneData?.is_on_biz_app === true && phoneData?.platform_type === 'CLOUD_API'
    }

    // 4. Salvar credenciais no Supabase
    await settingsDb.saveAll({
      phoneNumberId: phone_number_id,
      businessAccountId: waba_id,
      accessToken,
      isConnected: true,
    })

    if (displayPhoneNumber) await settingsDb.set('displayPhoneNumber', displayPhoneNumber)
    if (verifiedName) await settingsDb.set('verifiedName', verifiedName)
    await settingsDb.set('coexistenceEnabled', coexistenceEnabled ? 'true' : 'false')

    // 5. Assinar webhooks de coexistência no WABA
    try {
      const verifyToken = await getVerifyToken()
      const webhookUrl = computeWebhookUrl()

      if (!webhookUrl.includes('localhost')) {
        const form = new URLSearchParams()
        form.set(
          'subscribed_fields',
          'messages,message_echoes,smb_message_echoes,history,smb_app_state_sync,account_update'
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
      console.warn('[Coexistence] Falha ao assinar webhooks (best-effort):', webhookError)
    }

    // 6. Sincronizar contatos e histórico de mensagens (deve ser feito em até 24h após onboarding)
    //    Etapa 1: smb_app_state_sync (contatos)
    //    Etapa 2: history (histórico de mensagens)
    const syncResults: { contacts?: string; history?: string } = {}
    try {
      const syncContactsResponse = await fetchWithTimeout(
        `${META_API_BASE}/${phone_number_id}/smb_app_data`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            sync_type: 'smb_app_state_sync',
          }),
          cache: 'no-store',
          timeoutMs: 15000,
        }
      )
      if (syncContactsResponse.ok) {
        const contactsData = await safeJson<{ request_id?: string }>(syncContactsResponse)
        syncResults.contacts = contactsData?.request_id
      }
    } catch (e) {
      console.warn('[Coexistence] Falha ao iniciar sync de contatos (best-effort):', e)
    }

    try {
      const syncHistoryResponse = await fetchWithTimeout(
        `${META_API_BASE}/${phone_number_id}/smb_app_data`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            sync_type: 'history',
          }),
          cache: 'no-store',
          timeoutMs: 15000,
        }
      )
      if (syncHistoryResponse.ok) {
        const historyData = await safeJson<{ request_id?: string }>(syncHistoryResponse)
        syncResults.history = historyData?.request_id
      }
    } catch (e) {
      console.warn('[Coexistence] Falha ao iniciar sync de histórico (best-effort):', e)
    }

    return NextResponse.json({
      ok: true,
      phoneNumberId: phone_number_id,
      businessAccountId: waba_id,
      displayPhoneNumber,
      verifiedName,
      coexistenceEnabled,
      syncResults,
      message: 'Coexistência configurada com sucesso! Sincronização de contatos e histórico iniciada.',
    })
  } catch (error) {
    console.error('[Coexistence] Erro ao processar conexão:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
