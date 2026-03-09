/**
 * GET /api/meta/coexistence/status
 * Verifica se a coexistência está habilitada para o número configurado.
 * Campo: coexistence_enabled na Graph API do Meta.
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

  const url = `${META_API_BASE}/${credentials.phoneNumberId}?fields=id,coexistence_enabled`

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

  const data = await safeJson<{ id?: string; coexistence_enabled?: boolean }>(response)
  const coexistenceEnabled = data?.coexistence_enabled === true

  return NextResponse.json({
    ok: true,
    coexistenceEnabled,
    phoneNumberId: credentials.phoneNumberId,
  })
}
