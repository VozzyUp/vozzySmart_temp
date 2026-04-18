import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { fetchWithTimeout, safeJson } from '@/lib/server-http'

export const dynamic = 'force-dynamic'

/** GET /api/settings/embedded-signup — retorna Config ID salvo */
export async function GET() {
  const configId = await settingsDb.get('meta_config_id').catch(() => null)
  return NextResponse.json({ configId: configId || '' })
}

/** PATCH /api/settings/embedded-signup — salva Config ID */
export async function PATCH(request: NextRequest) {
  try {
    const { configId } = await request.json()
    if (configId) await settingsDb.set('meta_config_id', String(configId).trim())
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Falha ao salvar Config ID' }, { status: 500 })
  }
}

/**
 * POST /api/settings/embedded-signup
 *
 * Troca o authorization code do Embedded Signup por um access token permanente,
 * busca os dados do número de telefone na Meta API e salva as credenciais.
 *
 * Body: { code, phoneNumberId, wabaId, redirectUri }
 */
export async function POST(request: NextRequest) {
  let body: Record<string, string>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { code, phoneNumberId, wabaId, redirectUri } = body

  if (!code) {
    return NextResponse.json({ error: 'Authorization code é obrigatório' }, { status: 400 })
  }

  // Busca App ID e Secret — prefere banco, fallback para env vars
  const [dbAppId, dbAppSecret] = await Promise.all([
    settingsDb.get('metaAppId'),
    settingsDb.get('metaAppSecret'),
  ])

  const appId = dbAppId || process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || ''
  const appSecret = dbAppSecret || process.env.META_APP_SECRET || ''

  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: 'Meta App ID e App Secret precisam estar configurados nas Configurações' },
      { status: 422 }
    )
  }

  // Determina redirect URI: body → env var → APP_URL padrão
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || ''
  const callbackUri = redirectUri || `${appUrl}/embedded-signup-callback`

  // 1. Troca o código pelo access token
  const tokenRes = await fetchWithTimeout(
    'https://graph.facebook.com/v24.0/oauth/access_token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUri,
      }),
      timeoutMs: 10000,
    }
  )

  const tokenData = await safeJson<any>(tokenRes)

  if (!tokenRes.ok || !tokenData?.access_token) {
    console.error('[EmbeddedSignup] Token exchange failed:', tokenData)
    return NextResponse.json(
      {
        error: 'Falha ao trocar o código pelo token',
        details: tokenData?.error?.message || 'Verifique se o App Secret está correto e o código não expirou',
      },
      { status: 502 }
    )
  }

  const accessToken: string = tokenData.access_token

  // 2. Se não temos phone_number_id, busca o primeiro número vinculado ao WABA
  let resolvedPhoneNumberId = phoneNumberId || ''
  let displayPhoneNumber: string | undefined
  let verifiedName: string | undefined

  if (wabaId && !resolvedPhoneNumberId) {
    try {
      const phonesRes = await fetchWithTimeout(
        `https://graph.facebook.com/v24.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeoutMs: 8000,
        }
      )
      const phonesData = await safeJson<any>(phonesRes)
      const first = phonesData?.data?.[0]
      if (first) {
        resolvedPhoneNumberId = first.id
        displayPhoneNumber = first.display_phone_number
        verifiedName = first.verified_name
      }
    } catch (err) {
      console.warn('[EmbeddedSignup] Falha ao buscar phone numbers:', err)
    }
  }

  // 3. Se já temos phone_number_id, busca os detalhes do número
  if (resolvedPhoneNumberId && (!displayPhoneNumber || !verifiedName)) {
    try {
      const phoneRes = await fetchWithTimeout(
        `https://graph.facebook.com/v24.0/${resolvedPhoneNumberId}?fields=display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeoutMs: 8000,
        }
      )
      const phoneData = await safeJson<any>(phoneRes)
      displayPhoneNumber = phoneData?.display_phone_number
      verifiedName = phoneData?.verified_name
    } catch {
      // best-effort
    }
  }

  if (!resolvedPhoneNumberId || !wabaId) {
    // Retorna o token mas pede que o usuário informe os IDs manualmente
    return NextResponse.json({
      success: true,
      partial: true,
      accessToken,
      message: 'Token obtido, mas Phone Number ID e WABA ID precisam ser informados manualmente.',
    })
  }

  // 4. Salva credenciais no banco
  await settingsDb.saveAll({
    phoneNumberId: resolvedPhoneNumberId,
    businessAccountId: wabaId,
    accessToken,
    isConnected: true,
  })

  return NextResponse.json({
    success: true,
    phoneNumberId: resolvedPhoneNumberId,
    businessAccountId: wabaId,
    displayPhoneNumber,
    verifiedName,
    message: 'Credenciais salvas com sucesso via Embedded Signup.',
  })
}
