'use client';

/**
 * CoexistenceSection
 *
 * Seção de configurações para habilitar a Coexistência do WhatsApp Business.
 * Permite usar o WhatsApp Business App e a Cloud API simultaneamente no mesmo número.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Smartphone,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { Container } from '@/components/ui/container';

export interface CoexistenceSectionProps {
  coexistenceEnabled: boolean;
  coexistenceLoading: boolean;
  isConnectingCoexistence: boolean;
  onConnect: (params: { code: string; phone_number_id: string; waba_id: string }) => Promise<void>;
  onRefreshStatus: () => void;
  /** Quando false, exibe a seção como método alternativo de conexão inicial via Embedded Signup */
  isConnected?: boolean;
}

declare global {
  interface Window {
    FB?: {
      login: (
        callback: (response: { authResponse?: { code?: string }; status?: string }) => void,
        options: { config_id: string; response_type: string; override_default_response_type: boolean; extras?: object }
      ) => void;
    };
  }
}

export const CoexistenceSection: React.FC<CoexistenceSectionProps> = ({
  coexistenceEnabled,
  coexistenceLoading,
  isConnectingCoexistence,
  onConnect,
  onRefreshStatus,
  isConnected = true,
}) => {
  const [showInstructions, setShowInstructions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configId = process.env.NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID || '';

  // Armazena waba_id recebido via evento message do iframe da Meta
  // Para coexistência, o evento é FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING e só retorna waba_id
  // O phone_number_id é resolvido pelo backend via /{waba_id}/phone_numbers
  const sessionDataRef = useRef<{ waba_id?: string }>({});

  // Listener para o evento message enviado pela Meta quando o usuário conclui o fluxo
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== 'https://www.facebook.com' &&
        event.origin !== 'https://web.facebook.com'
      ) {
        return;
      }
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
            // Coexistência: apenas waba_id é retornado neste evento (phone_number_id vem do backend)
            sessionDataRef.current = { waba_id: data.data?.waba_id };
          } else if (data.event === 'FINISH') {
            // Fallback para fluxo padrão (sem coexistência)
            sessionDataRef.current = { waba_id: data.data?.waba_id };
          } else if (data.event === 'CANCEL') {
            console.warn('[Coexistence] Fluxo cancelado na etapa:', data.data?.current_step);
          } else if (data.event === 'ERROR') {
            console.error('[Coexistence] Erro no fluxo:', data.data?.error_message);
            setError(`Erro no fluxo Meta: ${data.data?.error_message || 'desconhecido'}`);
          }
        }
      } catch {
        // Mensagens não-JSON do iframe — ignorar
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectClick = () => {
    setError(null);
    sessionDataRef.current = {};

    if (!window.FB) {
      setError(
        'O SDK da Meta ainda não carregou. Aguarde um momento e tente novamente, ou recarregue a página.'
      );
      return;
    }

    if (!configId) {
      setError(
        'NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID não está configurado. Adicione ao seu .env e reinicie o servidor.'
      );
      return;
    }

    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          const code = response.authResponse.code;
          const { waba_id } = sessionDataRef.current;

          if (!waba_id) {
            setError(
              'Não foi possível obter o ID da conta WhatsApp Business. Por favor, complete todo o fluxo antes de fechar o popup.'
            );
            return;
          }

          // phone_number_id é resolvido automaticamente pelo backend via /{waba_id}/phone_numbers
          onConnect({ code, phone_number_id: '', waba_id }).catch((err) => {
            setError(err instanceof Error ? err.message : 'Erro ao conectar coexistência');
          });
        } else {
          setError(
            'Autorização não concluída. Por favor complete o fluxo de login da Meta.'
          );
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        // Conforme documentação oficial da Meta para coexistência:
        // https://developers.facebook.com/docs/whatsapp/embedded-signup/coexistence
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      }
    );
  };

  if (coexistenceLoading) {
    return (
      <Container variant="glass" padding="lg" className="border-[var(--ds-border-default)]">
        <div className="flex items-center gap-3 text-[var(--ds-text-secondary)]">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Verificando status da coexistência…</span>
        </div>
      </Container>
    );
  }

  return (
    <Container
      variant="glass"
      padding="lg"
      className={`border-transition-all duration-300 ${
        coexistenceEnabled
          ? 'border-blue-500/30'
          : 'border-[var(--ds-border-default)]'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={`p-3 rounded-xl border shrink-0 ${
            coexistenceEnabled
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'bg-[var(--ds-bg-surface)] text-[var(--ds-text-muted)] border-[var(--ds-border-default)]'
          }`}
        >
          <Smartphone size={24} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-[var(--ds-text-primary)]">
              {isConnected ? 'Coexistência do WhatsApp' : 'Conectar via WhatsApp Business App'}
            </h3>
            {coexistenceEnabled && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <CheckCircle2 size={11} />
                Ativa
              </span>
            )}
            {!isConnected && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--ds-bg-surface)] text-[var(--ds-text-muted)] border border-[var(--ds-border-default)]">
                Alternativa ao formulário manual
              </span>
            )}
          </div>

          <p className="text-sm text-[var(--ds-text-secondary)] mt-1 leading-relaxed">
            {coexistenceEnabled
              ? 'Seu WhatsApp Business App e a Cloud API estão funcionando juntos no mesmo número. Mensagens são sincronizadas em tempo real entre os dois.'
              : isConnected
                ? 'Use o WhatsApp Business App (celular) e a Cloud API simultaneamente no mesmo número, sem perder o histórico de conversas.'
                : 'Se você já usa o WhatsApp Business App no celular, clique aqui para conectar via QR code. Isso configura a Cloud API automaticamente e mantém o app funcionando em paralelo.'}
          </p>

          {/* Benefits when not yet enabled */}
          {!coexistenceEnabled && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {[
                'Mantém acesso ao WhatsApp Business App',
                'Histórico de conversas preservado',
                'Campanhas e automações via API',
                'Respostas manuais pelo celular',
              ].map((benefit) => (
                <div
                  key={benefit}
                  className="flex items-center gap-1.5 text-xs text-[var(--ds-text-secondary)]"
                >
                  <CheckCircle2 size={12} className="text-blue-400 shrink-0" />
                  {benefit}
                </div>
              ))}
            </div>
          )}

          {/* Instructions toggle */}
          {!coexistenceEnabled && (
            <button
              onClick={() => setShowInstructions((v) => !v)}
              className="mt-3 flex items-center gap-1 text-xs text-[var(--ds-text-muted)] hover:text-[var(--ds-text-secondary)] transition-colors"
            >
              {showInstructions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showInstructions ? 'Ocultar pré-requisitos' : 'Ver pré-requisitos'}
            </button>
          )}

          {/* Pre-requisites instructions */}
          {showInstructions && !coexistenceEnabled && (
            <div className="mt-3 p-3 rounded-lg bg-[var(--ds-bg-surface)]/50 border border-[var(--ds-border-default)] space-y-2.5">
              <p className="text-xs font-medium text-[var(--ds-text-primary)]">
                Antes de conectar, verifique:
              </p>
              <ol className="space-y-1.5">
                {[
                  'WhatsApp Business App atualizado para versão 2.24.17 ou superior',
                  'App da Meta com "Onboard WhatsApp Business App users" habilitado no Embedded Signup',
                  'Domínio do app adicionado em "Domínios permitidos" no Meta Developer Console',
                  'Número com histórico de conversas ativo nos últimos dias',
                ].map((step, i) => (
                  <li key={step} className="flex items-start gap-2 text-xs text-[var(--ds-text-secondary)]">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <a
                href="https://developers.facebook.com/docs/whatsapp/embedded-signup"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors mt-1"
              >
                Documentação oficial da Meta
                <ExternalLink size={10} />
              </a>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-[var(--ds-status-error-bg)] border border-[var(--ds-status-error)]/20">
              <AlertCircle size={14} className="text-[var(--ds-status-error-text)] shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--ds-status-error-text)]">{error}</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {coexistenceEnabled ? (
            <button
              onClick={onRefreshStatus}
              className="h-9 px-3 text-xs font-medium text-blue-400 border border-blue-500/20 bg-blue-500/5 rounded-xl hover:bg-blue-500/10 transition-colors flex items-center gap-1.5"
            >
              <CheckCircle2 size={13} />
              Verificar status
            </button>
          ) : (
            <button
              onClick={handleConnectClick}
              disabled={isConnectingCoexistence}
              className="h-9 px-4 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-sm"
            >
              {isConnectingCoexistence ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Conectando…
                </>
              ) : (
                <>
                  <Zap size={14} />
                  Conectar Coexistência
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </Container>
  );
};
