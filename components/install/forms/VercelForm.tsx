'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { TokenInput } from '../TokenInput';
import { ValidatingOverlay } from '../ValidatingOverlay';
import { Checkbox } from '@/components/ui/checkbox';
import { VALIDATION } from '@/lib/installer/types';
import type { FormProps } from './types';

/**
 * Form de token Vercel - Tema Blade Runner.
 * "Estabelecer Link Neural" - conexão com servidor de deploy.
 *
 * Substeps:
 * - Step 1: Validar token Vercel
 * - Step 2: Guiar usuário para autorizar GitHub App da Vercel no GitHub
 */
export function VercelForm({ data, onComplete, onBack, showBack }: FormProps) {
  const [token, setToken] = useState(data.vercelToken);
  const [validating, setValidating] = useState(false);
  const [linkEstablished, setLinkEstablished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [githubAuthConfirmed, setGithubAuthConfirmed] = useState(false);

  const handleValidate = async () => {
    if (token.trim().length < VALIDATION.VERCEL_TOKEN_MIN_LENGTH) {
      setError('Credenciais insuficientes');
      return;
    }

    setValidating(true);
    setError(null);

    // Tempo mínimo para apreciar a narrativa
    const MIN_VALIDATION_TIME = 2500;
    const startTime = Date.now();

    try {
      const res = await fetch('/api/installer/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          domain: typeof window !== 'undefined' ? window.location.hostname : '',
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Credenciais inválidas');
      }

      // Garantir tempo mínimo de exibição
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_VALIDATION_TIME) {
        await new Promise((r) => setTimeout(r, MIN_VALIDATION_TIME - elapsed));
      }

      setProjectName(result.project?.name || 'Link estabelecido');
      setLinkEstablished(true);
    } catch (err) {
      // Também garantir tempo mínimo em erro (para não parecer que nem tentou)
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_VALIDATION_TIME) {
        await new Promise((r) => setTimeout(r, MIN_VALIDATION_TIME - elapsed));
      }
      setError(err instanceof Error ? err.message : 'Falha na conexão');
      setToken('');
    } finally {
      setValidating(false);
    }
  };

  const handleFinish = () => {
    onComplete({ vercelToken: token.trim() });
  };

  // ---------------------------------------------------------------------------
  // VIEW: AUTORIZAR GITHUB NA VERCEL (DEPOIS DO TOKEN VALIDADO)
  // ---------------------------------------------------------------------------

  if (linkEstablished) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--br-deep-navy)] border border-[var(--br-neon-cyan)]/40 flex items-center justify-center">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 19.5h20L12 2z" className="text-[var(--br-neon-cyan)]" />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-bold tracking-wide text-[var(--br-hologram-white)] uppercase">
            Autorizar GitHub na Vercel
          </h2>
          <p className="mt-1 text-sm text-[var(--br-muted-cyan)] font-mono max-w-sm">
            Link neural com a Vercel estabelecido
            {projectName ? ` para o projeto "${projectName}".` : '.'} Agora falta autorizar a Vercel a acessar seus repositórios GitHub.
          </p>
        </div>

        {/* Instruções principais - Login Connection na Vercel é obrigatório */}
        <div className="p-4 rounded-xl bg-[var(--br-neon-cyan)]/10 border border-[var(--br-neon-cyan)]/30 space-y-3">
          <h4 className="font-medium text-[var(--br-neon-cyan)] flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[var(--br-neon-cyan)]/20 flex items-center justify-center text-xs">
              1
            </span>
            Conectar sua conta GitHub à sua conta Vercel
          </h4>
          <p className="text-xs text-[var(--br-muted-cyan)]">
            A Vercel precisa ter uma &quot;Login Connection&quot; com seu GitHub para conseguir criar o projeto e fazer o deploy. Faça isso pela conta Vercel:
          </p>
          <ol className="text-xs md:text-sm font-mono text-[var(--br-muted-cyan)] space-y-2 list-decimal list-inside">
            <li>
              Clique em <strong className="text-[var(--br-hologram-white)]">&quot;Abrir Vercel – Conectar GitHub&quot;</strong> abaixo (abre a página oficial da Vercel).
            </li>
            <li>
              Na Vercel, clique em <strong className="text-[var(--br-hologram-white)]">Connect GitHub</strong> e autorize com a mesma conta GitHub onde está o fork.
            </li>
            <li>
              Se o GitHub pedir, escolha <strong className="text-[var(--br-hologram-white)]">All repositories</strong> ou inclua o repositório do SmartZap.
            </li>
            <li>
              Clique em <strong className="text-[var(--br-hologram-white)]">Install</strong> / <strong className="text-[var(--br-hologram-white)]">Authorize</strong> e volte aqui.
            </li>
          </ol>

          <a
            href="https://vercel.com/integrations/git/github"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-[var(--br-neon-cyan)] text-[var(--br-void-black)] font-mono text-sm uppercase tracking-wider hover:bg-[var(--br-neon-cyan)]/90 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Abrir Vercel – Conectar GitHub
          </a>

          <p className="text-[10px] text-[var(--br-dust-gray)] mt-2 text-center">
            Deixe esta janela aberta, conclua a conexão na Vercel e no GitHub e depois confirme abaixo.
          </p>
        </div>

        {/* Confirmação */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--br-void-black)]/60 border border-[var(--br-dust-gray)]/40">
          <Checkbox
            id="confirm-vercel-github"
            checked={githubAuthConfirmed}
            onCheckedChange={(checked) => setGithubAuthConfirmed(checked === true)}
            className="mt-0.5 border-[var(--br-neon-cyan)] data-[state=checked]:bg-[var(--br-neon-cyan)]"
          />
          <label
            htmlFor="confirm-vercel-github"
            className="text-sm text-[var(--br-hologram-white)] cursor-pointer select-none leading-relaxed"
          >
            Confirmo que conectei minha conta GitHub à Vercel (Connect GitHub) e autorizei o acesso aos repositórios.
          </label>
        </div>

        {/* Ações */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleFinish}
            disabled={!githubAuthConfirmed}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--br-neon-cyan)] text-[var(--br-void-black)] font-mono text-xs uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--br-neon-cyan)]/90 transition-colors"
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW: TOKEN VERCEL (PASSO ORIGINAL)
  // ---------------------------------------------------------------------------

  return (
    <div className="relative space-y-5">
      <ValidatingOverlay
        isVisible={validating}
        message="Executando Voight-Kampff..."
        subMessage="Verificando autenticidade"
      />

      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-[var(--br-deep-navy)] border border-[var(--br-neon-magenta)]/30 flex items-center justify-center">
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 19.5h20L12 2z" className="text-[var(--br-neon-magenta)]" />
          </svg>
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-wide text-[var(--br-hologram-white)] uppercase">
          Estabelecer Link Neural
        </h2>
        <p className="mt-1 text-sm text-[var(--br-muted-cyan)] font-mono">
          Conexão com servidor de deploy
        </p>
      </div>

      {/* Token Input */}
      <TokenInput
        value={token}
        onChange={(val) => {
          setToken(val);
          setError(null);
        }}
        placeholder="cole as credenciais aqui..."
        validating={validating}
        error={error || undefined}
        minLength={VALIDATION.VERCEL_TOKEN_MIN_LENGTH}
        autoSubmitLength={VALIDATION.VERCEL_TOKEN_MIN_LENGTH}
        onAutoSubmit={handleValidate}
        showCharCount={false}
        accentColor="magenta"
        autoFocus
      />

      {/* Collapsible help - esconde durante validação */}
      {!validating && (
        <details className="w-full group">
          <summary className="flex items-center justify-center gap-1.5 text-sm font-mono text-[var(--br-dust-gray)] hover:text-[var(--br-muted-cyan)] cursor-pointer list-none transition-colors">
            <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
            como obter credenciais?
          </summary>
          <div className="mt-3 p-3 rounded-lg bg-[var(--br-void-black)]/50 border border-[var(--br-dust-gray)]/30 text-left space-y-2">
            <ol className="text-xs font-mono text-[var(--br-muted-cyan)] space-y-1.5 list-decimal list-inside">
              <li>
                Acesse{' '}
                <a
                  href="https://vercel.com/account/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--br-neon-magenta)] hover:underline"
                >
                  vercel.com/account/tokens
                </a>
              </li>
              <li>
                Clique em <strong className="text-[var(--br-hologram-white)]">Create</strong>
              </li>
              <li>
                Nome: <strong className="text-[var(--br-hologram-white)]">smartzap</strong> • Scope:{' '}
                <strong className="text-[var(--br-hologram-white)]">Full Account</strong>
              </li>
              <li>Copie e cole as credenciais acima</li>
            </ol>
          </div>
        </details>
      )}
    </div>
  );
}

