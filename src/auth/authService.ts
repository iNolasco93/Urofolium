import { createClient, type AuthChangeEvent, type SupabaseClient, type User } from '@supabase/supabase-js';
import { lockDatabase } from '../db/database';
import type { AuthUser } from '../lib/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

function toAuthUser(user: User): AuthUser {
  const fullName = typeof user.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name.trim()
    : '';
  const residencyStartMonth = typeof user.user_metadata?.residency_start_month === 'string'
    ? user.user_metadata.residency_start_month.trim()
    : '';
  return {
    id: user.id,
    email: user.email ?? '',
    displayName: fullName || null,
    residencyStartMonth: residencyStartMonth || null,
  };
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('No se pudo iniciar sesión');
  return toAuthUser(data.user);
}

export async function signUp(email: string, password: string, displayName: string): Promise<AuthUser | null> {
  const cleanEmail = email.trim();
  const cleanName = displayName.trim();

  if (cleanName.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres.');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: { full_name: cleanName },
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) throw new Error(error.message);
  return data.session && data.user ? toAuthUser(data.user) : null;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new Error(error.message);
}

export async function updatePassword(password: string): Promise<AuthUser> {
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('No se pudo actualizar la contraseña.');
  return toAuthUser(data.user);
}

export async function signOut(): Promise<void> {
  lockDatabase();
  await supabase.auth.signOut();
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return toAuthUser(data.user);
}

export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  const clean = displayName.trim();
  if (clean.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres.');

  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: clean },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('No se pudo actualizar el nombre.');
  return toAuthUser(data.user);
}

export async function updateAccountProfile(displayName: string, residencyStartMonth: string): Promise<AuthUser> {
  const cleanName = displayName.trim();
  const cleanStart = residencyStartMonth.trim();
  if (cleanName.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres.');
  if (cleanStart && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanStart)) {
    throw new Error('El inicio de residencia debe tener formato YYYY-MM.');
  }

  const { data, error } = await supabase.auth.updateUser({
    data: {
      full_name: cleanName,
      residency_start_month: cleanStart || null,
    },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('No se pudo actualizar el perfil.');
  return toAuthUser(data.user);
}

export function onAuthChange(callback: (user: AuthUser | null, event: AuthChangeEvent) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ? toAuthUser(session.user) : null, event);
  });
  return () => data.subscription.unsubscribe();
}

/** Recupera los datos de la DB original para la migración. */
export async function fetchSupabaseProcedures(): Promise<unknown[]> {
  const { data, error } = await supabase
    .from('procedures')
    .select('*')
    .order('fecha', { ascending: false });
  if (error) throw new Error('Error al leer Supabase: ' + error.message);
  return data ?? [];
}
