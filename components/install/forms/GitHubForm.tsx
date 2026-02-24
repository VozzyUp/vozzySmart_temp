'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Github } from 'lucide-react';
import { ValidatingOverlay } from '../ValidatingOverlay';
import { SuccessCheckmark } from '../SuccessCheckmark';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FormProps } from './types';

/**
 * Form de GitHub - OAuth + fork - Tema Blade Runner.
 * Segunda tela do wizard. Conecta via OAuth e cria fork do repositório.
 */
export function GitHubForm({ data, onComplete, onBack, showBack }: FormProps) {
  const [token, setToken] = useState(data.githubToken || '');
  const [repoName, setRepoName] = useState('');
  const [validating, setValidating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forkFullName, setForkFullName] = useState<string | null>(null);
  const [forkUrl, setForkUrl] = useState<string | null>(null);
  const [oauthInProgress, setOauthInProgress] = useState(false);

  const isValidRepoName = (name: string) => /^[a-zA-Z0-9_.-]{1,100}$/.test(name);

  const handleValidateAndFork = useCallback(
    async (forcedToken?: string) => {
      const tok = (forcedToken ?? token).trim();
      const repo = repoName.trim();

      if (!repo) {
        setError('Informe o nome do repositório');
        return;
      }
      if (!isValidRepoName(repo)) {
        setError('Nome do repositório inválido (use apenas letras, números, -, _ ou .)');
        return;
      }
      if (!tok) {
        setError('Falha ao obter autorização do GitHub. Tente conectar novamente.');
        return;
      }

      setValidating(true);
      setError(null);

      const MIN_VALIDATION_TIME = 3000;
      const startTime = Date.now();

      try {
        const res = await fetch('/api/installer/github/fork', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tok, repoName: repo }),
        });

        const result = await res.json();

        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_VALIDATION_TIME) {
          await new Promise((r) => setTimeout(r, MIN_VALIDATION_TIME - elapsed));
        }

        if (!res.ok || !result.success) {
          throw new Error(result.error || 'Falha ao criar fork');
        }

        setForkFullName(result.fullName || result.repoName || repo);
        setForkUrl(result.forkUrl || (result.fullName ? `https://github.com/${result.fullName}` : undefined));
        setSuccess(true);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_VALIDATION_TIME) {
          await new Promise((r) => setTimeout(r, MIN_VALIDATION_TIME - elapsed));
        }
        setError(err instanceof Error ? err.message : 'Falha ao conectar com GitHub');
      } finally {
        setValidating(false);
      }
    },
    [token, repoName]
  );

  const startOAuth = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      setError(null);
      setOauthInProgress(true);
      const state =
        (window.crypto && 'randomUUID' in window.crypto && window.crypto.randomUUID()) ||
        Math.random().toString(36).slice(2);
      window.sessionStorage.setItem('github_oauth_state', state);

      const width = 680;
      const height = 720;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      window.open(
        `/api/installer/github/oauth/authorize?state=${encodeURIComponent(state)}`,
        'github-oauth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (err) {
      setOauthInProgress(false);
      setError(err instanceof Error ? err.message : 'Falha ao abrir autorização do GitHub');
    }
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (typeof window === 'undefined') return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { type?: string; token?: string; error?: string; state?: string }
        | undefined;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'github-oauth-success') {
        const expectedState = window.sessionStorage.getItem('github_oauth_state') || '';
        if (!data.state || data.state !== expectedState) {
          return;
        }
        window.sessionStorage.removeItem('github_oauth_state');
        setOauthInProgress(false);
        setToken(data.token || '');
        setError(null);

        if (repoName.trim()) {
          void handleValidateAndFork(data.token || '');
        }
      } else if (data.type === 'github-oauth-error') {
        const expectedState = window.sessionStorage.getItem('github_oauth_state') || '';
        if (!data.state || data.state !== expectedState) {
          return;
        }
        window.sessionStorage.removeItem('github_oauth_state');
        setOauthInProgress(false);
        setError(data.error || 'Falha ao autorizar com o GitHub');
      }
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleValidateAndFork, repoName]);

  const handleSuccessComplete = () => {
    const username =
      forkFullName && forkFullName.includes('/')
        ? forkFullName.split('/')[0] || ''
        : '';

    onComplete({
      githubUsername: username,
      githubToken: token.trim(),
      githubForkUrl: forkUrl || (forkFullName ? `https://github.com/${forkFullName}` : undefined),
    });
  };

  if (success) {
    return (
      <SuccessCheckmark
        message={
          forkFullName
            ? `Fork criado: ${forkFullName}`
            : 'Fork criado no seu GitHub'
        }
        onComplete={handleSuccessComplete}
      />
    );
  }

  const inputClass = cn(
    'w-full pl-10 pr-4 py-3 rounded-lg',
    'bg-[var(--br-void-black)]/80 border border-[var(--br-dust-gray)]/50',
    'text-[var(--br-hologram-white)] placeholder:text-[var(--br-dust-gray)]',
    'font-mono text-sm',
    'focus:border-[var(--br-neon-cyan)] focus:outline-none',
    'focus:shadow-[0_0_15px_var(--br-neon-cyan)/0.3]',
    'transition-all duration-200'
  );

  return (
    <div className="relative space-y-5">
      <ValidatingOverlay
        isVisible={validating}
        message="Criando fork..."
        subMessage="Clonando repositório para sua conta"
      />

      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-[var(--br-deep-navy)] border border-[var(--br-neon-magenta)]/30 flex items-center justify-center">
          <Github className="w-7 h-7 text-[var(--br-neon-magenta)]" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-wide text-[var(--br-hologram-white)] uppercase">
          Configurar GitHub
        </h2>
        <p className="mt-1 text-sm text-[var(--br-muted-cyan)] font-mono">
          Conectar e criar fork automaticamente
        </p>
      </div>

      {/* Nome do repositório */}
      <div>
        <label className="block text-xs font-mono text-[var(--br-muted-cyan)] mb-2 uppercase tracking-wider">
          {'>'} Nome do repositório
        </label>
        <div className="relative">
          <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--br-dust-gray)]" />
          <input
            type="text"
            value={repoName}
            onChange={(e) => {
              setRepoName(e.target.value);
              setError(null);
            }}
            placeholder="ex: cliente-minha-loja-whatsapp"
            className={inputClass}
            autoFocus
          />
        </div>
        <p className="mt-1 text-[10px] font-mono text-[var(--br-dust-gray)]">
          Use apenas letras, números, hífen (-), underline (_) ou ponto (.). Esse será o nome do repositório no seu GitHub.
        </p>
      </div>

      <Button
        type="button"
        onClick={() => {
          if (token.trim()) {
            void handleValidateAndFork();
          } else {
            startOAuth();
          }
        }}
        disabled={
          validating ||
          oauthInProgress ||
          !repoName.trim() ||
          !isValidRepoName(repoName.trim())
        }
        className="w-full font-mono uppercase tracking-wider bg-[var(--br-neon-magenta)] hover:bg-[var(--br-neon-magenta)]/80 text-[var(--br-hologram-white)] font-bold shadow-[0_0_20px_var(--br-neon-magenta)/0.4] transition-all duration-200"
      >
        {token.trim() ? 'Criar fork' : 'Conectar GitHub e criar fork'}
      </Button>

      {!validating && (
        <details className="w-full group">
          <summary className="flex items-center justify-center gap-1.5 text-sm font-mono text-[var(--br-dust-gray)] hover:text-[var(--br-muted-cyan)] cursor-pointer list-none transition-colors">
            <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
            Como criar conta e repo?
          </summary>
          <div className="mt-3 p-3 rounded-lg bg-[var(--br-void-black)]/50 border border-[var(--br-dust-gray)]/30 text-left space-y-2">
            <ol className="text-xs font-mono text-[var(--br-muted-cyan)] space-y-2 list-decimal list-inside">
              <li>
                <span className="font-semibold text-[var(--br-hologram-white)]">Criar conta GitHub (se ainda não tiver)</span>
                <ol className="mt-1 ml-4 list-disc space-y-1">
                  <li>
                    Acesse{' '}
                    <a
                      href="https://github.com/signup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--br-neon-magenta)] hover:underline"
                    >
                      github.com/signup
                    </a>
                  </li>
                  <li>Preencha email, senha e escolha um username.</li>
                  <li>Confirme o email para ativar a conta.</li>
                </ol>
              </li>
              <li>
                <span className="font-semibold text-[var(--br-hologram-white)]">Autorizar acesso ao GitHub</span>
                <ol className="mt-1 ml-4 list-disc space-y-1">
                  <li>
                    Nesta tela, clique em <strong className="text-[var(--br-hologram-white)]">Conectar GitHub e criar fork</strong>. Uma nova janela do GitHub será aberta.
                  </li>
                  <li>
                    Confira os dados no GitHub, clique em <strong className="text-[var(--br-hologram-white)]">Authorize</strong> e aguarde alguns segundos.
                </ol>
              </li>
              <li>
                <span className="font-semibold text-[var(--br-hologram-white)]">Escolher o nome do repositório</span>
                <ol className="mt-1 ml-4 list-disc space-y-1">
                  <li>Defina um nome único para o repositório (ex.: <code>cliente-minha-loja-whatsapp</code>).</li>
                  <li>Digite esse nome no campo \"Nome do repositório\" acima e clique em <strong>Conectar GitHub e criar fork</strong>.</li>
                </ol>
              </li>
            </ol>
          </div>
        </details>
      )}
    </div>
  );
}
