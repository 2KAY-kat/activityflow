import jwt from 'jsonwebtoken';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_AUTH_URL = 'https://github.com/login/oauth';
const GITHUB_API_VERSION = '2026-03-10';

type GitHubRequestOptions = {
  method?: string;
  token?: string;
  body?: unknown;
  accept?: string;
  signal?: AbortSignal;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getAppPrivateKey() {
  return getRequiredEnv('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
}

export function getGitHubAppConfig() {
  return {
    appId: getRequiredEnv('GITHUB_APP_ID'),
    clientId: getRequiredEnv('GITHUB_APP_CLIENT_ID'),
    clientSecret: getRequiredEnv('GITHUB_APP_CLIENT_SECRET'),
    privateKey: getAppPrivateKey(),
    appSlug: process.env.GITHUB_APP_SLUG || '',
  };
}

export function isGitHubAppConfigured() {
  try {
    getGitHubAppConfig();
    return true;
  } catch {
    return false;
  }
}

export function getGitHubAppInstallUrl() {
  const { appSlug } = getGitHubAppConfig();
  if (!appSlug) {
    throw new Error('Missing required environment variable: GITHUB_APP_SLUG');
  }

  return `https://github.com/apps/${appSlug}/installations/new`;
}

export function getAppBaseUrl() {
  const rawBaseUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  return rawBaseUrl.replace(/\/$/, '');
}

export function getGitHubCallbackUrl() {
  return `${getAppBaseUrl()}/api/auth/github/callback`;
}

export function createGitHubAppJwt() {
  const { appId, privateKey } = getGitHubAppConfig();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    },
    privateKey,
    { algorithm: 'RS256' }
  );
}

async function parseGitHubResponse(response: Response) {
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.message || `GitHub request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function githubRequest(path: string, options: GitHubRequestOptions = {}) {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    method: options.method || 'GET',
    signal: options.signal,
    headers: {
      Accept: options.accept || 'application/vnd.github+json',
      Authorization: options.token ? `Bearer ${options.token}` : '',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return parseGitHubResponse(response);
}

function getGitHubHealthErrorMessage(error: any) {
  if (error?.name === 'AbortError') {
    return 'GitHub health check timed out';
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return 'GitHub health check failed';
}

export async function checkGitHubAppHealth(timeoutMs = 4000) {
  if (!isGitHubAppConfigured()) {
    return {
      enabled: false,
      status: 'not_configured' as const,
      message: 'GitHub App is not configured',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const appJwt = createGitHubAppJwt();
    const app = await githubRequest('/app', {
      token: appJwt,
      signal: controller.signal,
    });

    return {
      enabled: true,
      status: 'connected' as const,
      appSlug: typeof app?.slug === 'string' ? app.slug : null,
      appName: typeof app?.name === 'string' ? app.name : null,
    };
  } catch (error: any) {
    return {
      enabled: true,
      status: 'error' as const,
      message: getGitHubHealthErrorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function githubRequestAllPages(path: string, token: string) {
  const items: any[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await githubRequest(`${path}${separator}per_page=${perPage}&page=${page}`, { token });

    if (!Array.isArray(response)) {
      if (Array.isArray(response.repositories)) {
        items.push(...response.repositories);
        if (response.repositories.length < perPage) {
          break;
        }
      } else if (Array.isArray(response.installations)) {
        items.push(...response.installations);
        if (response.installations.length < perPage) {
          break;
        }
      } else {
        throw new Error('Unexpected paginated GitHub response');
      }
    } else {
      items.push(...response);
      if (response.length < perPage) {
        break;
      }
    }

    page += 1;
  }

  return items;
}

export function buildGitHubAuthorizeUrl(state: string) {
  const { clientId } = getGitHubAppConfig();
  const redirectUri = getGitHubCallbackUrl();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    allow_signup: 'true',
    prompt: 'select_account',
  });

  return `${GITHUB_AUTH_URL}/authorize?${params.toString()}`;
}

export async function exchangeCodeForUserToken(code: string) {
  const { clientId, clientSecret } = getGitHubAppConfig();
  const redirectUri = getGitHubCallbackUrl();

  const response = await fetch(`${GITHUB_AUTH_URL}/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  return parseGitHubResponse(response);
}

export async function fetchGitHubUser(token: string) {
  return githubRequest('/user', { token });
}

export async function listAppInstallations() {
  const appJwt = createGitHubAppJwt();
  return githubRequestAllPages('/app/installations', appJwt);
}

export async function getAppInstallation(installationId: number) {
  const appJwt = createGitHubAppJwt();
  return githubRequest(`/app/installations/${installationId}`, { token: appJwt });
}

export async function createInstallationAccessToken(installationId: number) {
  const appJwt = createGitHubAppJwt();
  return githubRequest(`/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    token: appJwt,
  });
}

export async function listInstallationRepositories(installationToken: string) {
  return githubRequest('/installation/repositories', { token: installationToken });
}

export async function listRepositoryCollaborators(installationToken: string, owner: string, repo: string) {
  return githubRequestAllPages(`/repos/${owner}/${repo}/collaborators`, installationToken);
}
