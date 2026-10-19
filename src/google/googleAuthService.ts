import { getLocalSecret, setLocalSecret, removeLocalSecrets, getDatabaseOwner, assertDatabaseOwner } from '../db/database';

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SCRIPT_ID = 'google-identity-services';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

const TOKEN_KEY = 'google_access_token';
const TOKEN_EXPIRY_KEY = 'google_token_expiry';
const CONNECTED_AT_KEY = 'google_drive_connected_at';

let gisScriptPromise: Promise<void> | null = null;

type TokenPrompt = '' | 'consent' | 'select_account' | 'none';

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: TokenPrompt }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            include_granted_scopes?: boolean;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

function getConfigError(): string | null {
  if (GOOGLE_CLIENT_ID) return null;
  return 'Falta configurar VITE_GOOGLE_CLIENT_ID con un OAuth Client ID web de Google Cloud.';
}

function assertConfigured(): void {
  const error = getConfigError();
  if (error) throw new Error(error);
}

function toStoredExpiry(expiresIn: number): string {
  return String(Date.now() + expiresIn * 1000);
}

async function saveToken(accessToken: string, expiresIn: number): Promise<void> {
  const userId = getDatabaseOwner();
  await setLocalSecret(TOKEN_KEY, accessToken);
  assertDatabaseOwner(userId);
  await setLocalSecret(TOKEN_EXPIRY_KEY, toStoredExpiry(expiresIn));
  assertDatabaseOwner(userId);
  await setLocalSecret(CONNECTED_AT_KEY, new Date().toISOString());
}

async function getStoredAccessToken(): Promise<string | null> {
  const userId = getDatabaseOwner();
  const token = await getLocalSecret(TOKEN_KEY);
  assertDatabaseOwner(userId);
  const expiry = await getLocalSecret(TOKEN_EXPIRY_KEY);
  assertDatabaseOwner(userId);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry, 10) - 60000) return null;
  return token;
}

async function hasPreviousGoogleGrant(): Promise<boolean> {
  return !!(await getLocalSecret(CONNECTED_AT_KEY));
}

function loadGoogleIdentityServices(): Promise<void> {
  assertConfigured();

  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GIS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true' && !window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services no esta disponible en este navegador.'));
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => {
        gisScriptPromise = null;
        reject(new Error('No se pudo cargar Google Identity Services.'));
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      gisScriptPromise = null;
      script.remove();
      reject(new Error('No se pudo cargar Google Identity Services.'));
    };
    document.head.appendChild(script);
  });

  return gisScriptPromise;
}

async function requestAccessToken(prompt: TokenPrompt): Promise<string> {
  const userId = getDatabaseOwner();
  await loadGoogleIdentityServices();
  assertDatabaseOwner(userId);

  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('Google Identity Services no esta disponible en este navegador.'));
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      include_granted_scopes: true,
      callback: response => {
        try { assertDatabaseOwner(userId); } catch (error) { reject(error); return; }
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        if (!response.access_token) {
          reject(new Error('Google no devolvio un token de acceso.'));
          return;
        }

        saveToken(response.access_token, response.expires_in ?? 3600)
          .then(() => resolve(response.access_token as string))
          .catch(reject);
      },
      error_callback: error => {
        reject(new Error(error.message || error.type || 'No se pudo autorizar Google Drive.'));
      },
    });

    client.requestAccessToken({ prompt });
  });
}

export function isGoogleDriveConfigured(): boolean {
  return !getConfigError();
}

export function getGoogleDriveConfigError(): string | null {
  return getConfigError();
}

export async function connectGoogleDrive(): Promise<void> {
  await requestAccessToken('consent');
}

export async function ensureGoogleDriveAccess(): Promise<void> {
  const stored = await getStoredAccessToken();
  if (stored) return;
  const prompt: TokenPrompt = await hasPreviousGoogleGrant() ? '' : 'consent';
  await requestAccessToken(prompt);
}

export async function clearGoogleTokens(): Promise<void> {
  await removeLocalSecrets([TOKEN_KEY, TOKEN_EXPIRY_KEY, CONNECTED_AT_KEY]);
}

export async function getValidAccessToken(): Promise<string> {
  assertConfigured();
  const stored = await getStoredAccessToken();
  if (stored) return stored;
  throw new Error('La sesion de Google Drive caduco. Pulsa Conectar o renovar Google Drive en Ajustes.');
}

export async function isGoogleSignedIn(): Promise<boolean> {
  if (!isGoogleDriveConfigured()) return false;
  return !!(await getStoredAccessToken());
}
