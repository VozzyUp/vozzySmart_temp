import { NextRequest } from 'next/server';

const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function htmlPage(script: string, message: string) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charSet="utf-8" />
    <title>GitHub OAuth</title>
  </head>
  <body style="background:#020817;color:#e5e7eb;font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
    <div style="text-align:center;max-width:320px;padding:16px;border-radius:8px;background:#020617;border:1px solid #1f2937;">
      <p style="margin-bottom:12px;font-size:14px;">${message}</p>
      <p style="font-size:12px;color:#9ca3af;">Você já pode fechar esta janela.</p>
    </div>
    <script>
${script}
    </script>
  </body>
</html>`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const script = `
      (function () {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: 'github-oauth-error', error: 'Configuração do GitHub OAuth ausente no servidor.', state: ${JSON.stringify(
              state
            )} },
            '*'
          );
        }
        window.close();
      })();
    `;
    return new Response(htmlPage(script, 'Erro de configuração do servidor (GitHub OAuth).'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!code) {
    const script = `
      (function () {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: 'github-oauth-error', error: 'Código de autorização ausente.', state: ${JSON.stringify(
              state
            )} },
            '*'
          );
        }
        window.close();
      })();
    `;
    return new Response(htmlPage(script, 'Não foi possível concluir a autorização com o GitHub.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const tokenRes = await fetch(GITHUB_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenData.access_token) {
      const msg = tokenData.error_description || tokenData.error || 'Falha ao obter token do GitHub.';
      const scriptError = `
        (function () {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
              { type: 'github-oauth-error', error: ${JSON.stringify(msg)}, state: ${JSON.stringify(state)} },
              '*'
            );
          }
          window.close();
        })();
      `;
      return new Response(htmlPage(scriptError, 'Não foi possível concluir a autorização com o GitHub.'), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const token = tokenData.access_token;
    const scriptSuccess = `
      (function () {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: 'github-oauth-success', token: ${JSON.stringify(token)}, state: ${JSON.stringify(state)} },
            '*'
          );
        }
        window.close();
      })();
    `;

    return new Response(htmlPage(scriptSuccess, 'Autorização concluída com sucesso.'), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
    const script = `
      (function () {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: 'github-oauth-error', error: ${JSON.stringify(msg)}, state: ${JSON.stringify(state)} },
            '*'
          );
        }
        window.close();
      })();
    `;
    return new Response(htmlPage(script, 'Erro ao comunicar com o GitHub.'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

