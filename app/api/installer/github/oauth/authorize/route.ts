import { NextRequest, NextResponse } from 'next/server';

const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

export async function GET(req: NextRequest) {
  if (process.env.INSTALLER_ENABLED === 'false') {
    return NextResponse.json({ error: 'Installer desabilitado' }, { status: 403 });
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'GITHUB_OAUTH_CLIENT_ID não configurado no servidor.' },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const state = url.searchParams.get('state') || '';

  const origin =
    process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL.length > 0
      ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
      : `${url.protocol}//${url.host}`;

  const callbackUrl = `${origin}/api/installer/github/oauth/callback`;

  const authorizeUrl = new URL(GITHUB_OAUTH_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizeUrl.searchParams.set('scope', 'repo');
  if (state) {
    authorizeUrl.searchParams.set('state', state);
  }

  return NextResponse.redirect(authorizeUrl.toString());
}

