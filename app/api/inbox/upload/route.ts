/**
 * POST /api/inbox/upload
 * Upload de mídia para o inbox (imagens, vídeos, áudios, documentos)
 * Armazena no Supabase Storage e retorna a URL pública
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

const BUCKET = 'inbox-media'
const MAX_SIZES: Record<string, number> = {
  image: 5 * 1024 * 1024,      // 5MB
  video: 16 * 1024 * 1024,     // 16MB
  audio: 16 * 1024 * 1024,     // 16MB
  document: 100 * 1024 * 1024, // 100MB
}

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/3gpp': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/aac': 'audio',
  'audio/ogg': 'audio',
  'audio/webm': 'audio',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/zip': 'document',
  'text/plain': 'document',
  'text/csv': 'document',
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      return NextResponse.json({ error: 'Storage não configurado' }, { status: 503 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
    }

    const mimeType = file.type || 'application/octet-stream'
    // Normaliza MIME type removendo parâmetros de codec (ex: "audio/webm;codecs=opus" → "audio/webm")
    const baseMimeType = mimeType.split(';')[0].trim()
    // WebM com Opus é o mesmo codec do OGG/Opus — trata como audio/ogg para compatibilidade WhatsApp
    const normalizedMimeType = baseMimeType === 'audio/webm' ? 'audio/ogg' : baseMimeType
    const category = ALLOWED_TYPES[normalizedMimeType]

    if (!category) {
      return NextResponse.json(
        { error: `Tipo de arquivo não suportado: ${mimeType}` },
        { status: 400 }
      )
    }

    const maxSize = MAX_SIZES[category]
    if (file.size > maxSize) {
      const maxMB = maxSize / 1024 / 1024
      return NextResponse.json(
        { error: `Arquivo muito grande. Máximo: ${maxMB}MB` },
        { status: 400 }
      )
    }

    // Gerar caminho único com timestamp
    const ext = getExtension(file.name, normalizedMimeType)
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const path = `${category}/${timestamp}-${random}.${ext}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    // Garantir que o bucket existe (cria se necessário)
    await ensureBucket(supabase)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: normalizedMimeType,
        upsert: false,
      })

    if (uploadError) {
      console.error('[inbox/upload] Erro no upload:', uploadError)
      return NextResponse.json(
        { error: 'Falha ao fazer upload do arquivo' },
        { status: 500 }
      )
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(path)

    return NextResponse.json({
      url: urlData.publicUrl,
      filename: file.name,
      mimeType: normalizedMimeType,
      category,
      size: file.size,
    })
  } catch (error) {
    console.error('[inbox/upload]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

function getExtension(filename: string, mimeType: string): string {
  const fromName = filename.split('.').pop()?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName

  const mimeExtMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'application/pdf': 'pdf',
  }
  return mimeExtMap[mimeType] || 'bin'
}

async function ensureBucket(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const { data: buckets } = await supabase.storage.listBuckets()
  if (buckets?.some((b) => b.id === BUCKET)) return

  await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 104857600,
  })
}
