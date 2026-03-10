/**
 * GET /api/meta/coexistence/status
 *
 * Verifica se a coexistência está ativa para o número configurado.
 * Conforme docs oficiais da Meta, usa os campos is_on_biz_app e platform_type:
 * - is_on_biz_app=true + platform_type=CLOUD_API → coexistência ativa
 */

import { NextResponse } from 'next/server'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { fetchWithTimeout, safeJson } from '@/lib/server-http'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface CoexistenceStatusResponse {
  ok: boolean
  coexistenceEnabled: boolean
  phoneNumberId?: string
  isOnBizApp?: boolean
  platformType?: string
  error?: string
}

export async function GET(): Promise<NextResponse<CoexistenceStatusResponse>> {
  const credentials = await getWhatsAppCredentials()

  if (!credentials?.phoneNumberId || !credentials?.accessToken) {
    return NextResponse.json(
      { ok: false, coexistenceEnabled: false, error: 'Credenciais não configuradas.' },
      { status: 401 }
    )
  }

  const url = `${META_API_BASE}/${credentials.phoneNumberId}?fields=id,is_on_biz_app,platform_type`

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
    cache: 'no-store',
    timeoutMs: 10000,
  })

  if (!response.ok) {
    const errorData = await safeJson<{ error?: { message?: string } }>(response)
    const message = errorData?.error?.message || 'Erro ao consultar status de coexistência'
    return NextResponse.json(
      { ok: false, coexistenceEnabled: false, error: message },
      { status: response.status }
    )
  }

  const data = await safeJson<{
    id?: string
    is_on_biz_app?: boolean
    platform_type?: string
  }>(response)

  // Coexistência ativa = número está no app WhatsApp Business E na Cloud API
  const coexistenceEnabled =
    data?.is_on_biz_app === true && data?.platform_type === 'CLOUD_API'

  return NextResponse.json({
    ok: true,
    coexistenceEnabled,
    phoneNumberId: credentials.phoneNumberId,
    isOnBizApp: data?.is_on_biz_app,
    platformType: data?.platform_type,
  })
}
