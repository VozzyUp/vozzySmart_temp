/**
 * GET /api/inbox/media/[mediaId]
 * Proxy para baixar mídias recebidas via Meta WhatsApp API.
 *
 * Dois modos:
 * - /api/inbox/media/1234567890  → resolve media_id via Graph API
 * - /api/inbox/media/url?src=https://... → proxeia URL direta do CDN da Meta
 */

import { NextRequest, NextResponse } from 'next/server'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ mediaId: string }>
}

async function serveBuffer(
  request: NextRequest,
  buffer: ArrayBuffer,
  contentType: string
): Promise<NextResponse> {
  // Remove parâmetros de codec para melhor compatibilidade com browsers
  const safeContentType = contentType.split(';')[0].trim() || 'application/octet-stream'
  const totalSize = buffer.byteLength

  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (match) {
      const start = parseInt(match[1], 10)
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1
      return new NextResponse(buffer.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Type': safeContentType,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',
        },
      })
    }
  }

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': safeContentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': String(totalSize),
    },
  })
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { mediaId } = await params

    if (!mediaId || mediaId.length < 3) {
      return NextResponse.json({ error: 'mediaId inválido' }, { status: 400 })
    }

    const credentials = await getWhatsAppCredentials()
    if (!credentials?.accessToken) {
      return NextResponse.json({ error: 'Credenciais WhatsApp não configuradas' }, { status: 503 })
    }

    // Modo URL direta: /api/inbox/media/url?src=https://...
    if (mediaId === 'url') {
      const src = request.nextUrl.searchParams.get('src')
      if (!src) return NextResponse.json({ error: 'src obrigatório' }, { status: 400 })

      const fileRes = await fetch(src, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        signal: AbortSignal.timeout(30000),
      })
      if (!fileRes.ok) {
        console.error(`[inbox/media/url] Falha ao baixar: ${fileRes.status}`)
        return NextResponse.json({ error: 'Falha ao baixar mídia' }, { status: 502 })
      }
      const contentType = fileRes.headers.get('content-type') || 'audio/ogg'
      return serveBuffer(request, await fileRes.arrayBuffer(), contentType)
    }

    // Modo media_id: resolve via Graph API
    // 1. Buscar URL temporária do Meta
    const metaInfoRes = await fetch(
      `https://graph.facebook.com/v24.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        signal: AbortSignal.timeout(8000),
      }
    )

    if (!metaInfoRes.ok) {
      const err = await metaInfoRes.json().catch(() => ({}))
      console.error('[inbox/media] Meta API error:', err)
      return NextResponse.json(
        { error: 'Não foi possível obter URL da mídia', details: err },
        { status: 502 }
      )
    }

    const mediaInfo = await metaInfoRes.json() as { url?: string; mime_type?: string }

    if (!mediaInfo.url) {
      return NextResponse.json({ error: 'URL de mídia não encontrada' }, { status: 404 })
    }

    // 2. Baixar o arquivo do Meta
    const fileRes = await fetch(mediaInfo.url, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(30000),
    })

    if (!fileRes.ok) {
      console.error(`[inbox/media] Falha ao baixar arquivo: ${fileRes.status}`)
      return NextResponse.json({ error: 'Falha ao baixar mídia' }, { status: 502 })
    }

    const contentType = mediaInfo.mime_type || fileRes.headers.get('content-type') || 'audio/ogg'
    return serveBuffer(request, await fileRes.arrayBuffer(), contentType)
  } catch (error) {
    console.error('[inbox/media]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
