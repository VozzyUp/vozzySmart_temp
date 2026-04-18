'use client'

import React, { forwardRef, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/ui/section-header'
import { WhatsAppCredentialsForm, type WhatsAppCredentials } from '@/components/shared/WhatsAppCredentialsForm'
import { EmbeddedSignupButton } from './EmbeddedSignupButton'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { settingsService } from '@/services/settingsService'
import type { AppSettings } from '../../../types'
import type { MetaAppInfo } from './types'

interface CredentialsFormProps {
  settings: AppSettings
  setSettings: (settings: AppSettings) => void
  onSave: () => void
  onClose: () => void
  isSaving: boolean
  onTestConnection?: () => void
  isTestingConnection?: boolean
  metaApp?: MetaAppInfo | null
  refreshMetaApp?: () => void
}

/**
 * Formulário de credenciais WhatsApp para a página de configurações.
 *
 * Usa o componente centralizado WhatsAppCredentialsForm e adiciona:
 * - Container visual com estilo glass
 * - Integração com o sistema de settings do SmartZap
 * - Salvamento de Meta App ID junto com credenciais principais
 */
export const CredentialsForm = forwardRef<HTMLDivElement, CredentialsFormProps>(
  (
    {
      settings,
      setSettings,
      onSave,
      onClose,
      isSaving,
      onTestConnection,
      isTestingConnection,
      metaApp,
      refreshMetaApp,
    },
    ref
  ) => {
    const [localIsSaving, setLocalIsSaving] = useState(false)

    // Estado local para Meta App (não faz parte do settings principal)
    const [metaAppIdLocal, setMetaAppIdLocal] = useState(metaApp?.appId || '')
    const [metaAppSecretLocal, setMetaAppSecretLocal] = useState('')
    const [configIdLocal, setConfigIdLocal] = useState('')

    // Sincroniza com metaApp externo
    useEffect(() => {
      setMetaAppIdLocal(metaApp?.appId || '')
    }, [metaApp?.appId])

    // Carrega Config ID do banco
    useEffect(() => {
      fetch('/api/settings/embedded-signup')
        .then((r) => r.json())
        .then((d) => { if (d?.configId) setConfigIdLocal(d.configId) })
        .catch(() => {})
    }, [])

    // Monta os valores para o formulário centralizado
    const credentialsValues: WhatsAppCredentials = {
      phoneNumberId: settings.phoneNumberId || '',
      businessAccountId: settings.businessAccountId || '',
      accessToken: settings.accessToken || '',
      metaAppId: metaAppIdLocal,
      metaAppSecret: metaAppSecretLocal,
    }

    // Handler para mudança de valores
    const handleChange = useCallback(
      (values: WhatsAppCredentials) => {
        // Atualiza settings principal (phoneNumberId, businessAccountId, accessToken)
        setSettings({
          ...settings,
          phoneNumberId: values.phoneNumberId,
          businessAccountId: values.businessAccountId,
          accessToken: values.accessToken,
        })

        // Atualiza estado local do Meta App
        setMetaAppIdLocal(values.metaAppId || '')
        setMetaAppSecretLocal(values.metaAppSecret || '')
      },
      [settings, setSettings]
    )

    // Handler para salvar
    const handleSave = async () => {
      try {
        setLocalIsSaving(true)

        // Salva credenciais principais
        await onSave()
        onClose()

        // Best-effort: salva Meta App ID junto, sem bloquear o salvamento do WhatsApp
        const nextAppId = metaAppIdLocal.trim()
        const nextAppSecret = metaAppSecretLocal.trim()
        const currentAppId = String(metaApp?.appId || '').trim()

        // Se mudou o App ID ou temos um novo secret
        if (nextAppId && (nextAppId !== currentAppId || nextAppSecret)) {
          settingsService
            .saveMetaAppConfig({
              appId: nextAppId,
              appSecret: nextAppSecret || '', // Mantém vazio se não fornecido
            })
            .then(() => {
              refreshMetaApp?.()
            })
            .catch((e) => {
              // Não bloqueia o fluxo principal
              toast.warning(e instanceof Error ? e.message : 'Falha ao salvar Meta App ID')
            })
        }
      } catch {
        // Erro já tratado no hook, não fecha o formulário
      } finally {
        setLocalIsSaving(false)
      }
    }

    return (
      <div ref={ref} className="scroll-mt-24">
        <Container
          variant="glass"
          padding="lg"
          className="animate-in slide-in-from-top-4 duration-300"
        >
          <SectionHeader title="Configuração da API" color="brand" showIndicator={true} />

          {/* Embedded Signup — conexão rápida via Meta */}
          <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900/50 p-4 space-y-3">
            <p className="text-sm font-medium text-zinc-200">Conectar via Meta (Embedded Signup)</p>
            <p className="text-xs text-zinc-500">
              Autorize automaticamente sem copiar tokens manualmente. Requer Meta App ID e Config ID configurados abaixo.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="meta-config-id" className="text-xs">Config ID do Embedded Signup</Label>
              <div className="flex gap-2">
                <Input
                  id="meta-config-id"
                  placeholder="Ex: 2774375056250205"
                  value={configIdLocal}
                  onChange={(e) => setConfigIdLocal(e.target.value)}
                  className="font-mono text-sm bg-zinc-950"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!configIdLocal.trim()) return
                    fetch('/api/settings/embedded-signup', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ configId: configIdLocal.trim() }),
                    }).catch(() => {})
                  }}
                  className="shrink-0 rounded-md border border-zinc-600 bg-zinc-800 px-3 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  Salvar
                </button>
              </div>
              <p className="text-xs text-zinc-600">Encontrado em: Meta for Developers → App → WhatsApp → Cadastro Incorporado</p>
            </div>
            <EmbeddedSignupButton
              appId={metaAppIdLocal}
              configId={configIdLocal}
              onSuccess={({ phoneNumberId, businessAccountId, displayPhoneNumber, verifiedName }) => {
                setSettings({
                  ...settings,
                  phoneNumberId,
                  businessAccountId,
                  accessToken: settings.accessToken, // token já salvo pelo backend
                  isConnected: true,
                })
                toast.success('Conectado!', {
                  description: displayPhoneNumber
                    ? `${displayPhoneNumber}${verifiedName ? ` • ${verifiedName}` : ''}`
                    : undefined,
                })
                refreshMetaApp?.()
                onClose()
              }}
            />
          </div>

          <div className="relative my-6 flex items-center gap-3">
            <div className="flex-1 border-t border-zinc-700" />
            <span className="text-xs text-zinc-500">ou configure manualmente</span>
            <div className="flex-1 border-t border-zinc-700" />
          </div>

          <div className="mt-0">
            <WhatsAppCredentialsForm
              values={credentialsValues}
              onChange={handleChange}
              onSave={handleSave}
              showMetaApp={true}
              showAppSecret={true}
              hasAppSecretSaved={metaApp?.hasAppSecret ?? false}
              showValidateButton={true}
              showSaveButton={true}
              showTestButton={true}
              showHelpLink={true}
              saveButtonText="Salvar Config"
              isSaving={isSaving || localIsSaving}
              isTesting={isTestingConnection}
              variant="default"
            />
          </div>
        </Container>
      </div>
    )
  }
)

CredentialsForm.displayName = 'CredentialsForm'
