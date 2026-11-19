import { createClient } from '@supabase/supabase-js';
import { clientConfiguration } from './client-config.ts';
export const AUTH_STORAGE_KEY='rekonvia.auth.v1';
const configuration=clientConfiguration(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const supabaseUrl=configuration?.url;
export const publishableKey=configuration?.key;
export const supabase=supabaseUrl && publishableKey?createClient(supabaseUrl,publishableKey,{
  auth:{storageKey:AUTH_STORAGE_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
}):null;
export function clearAuthStorage() {
  try{for(const suffix of ['','-code-verifier','-user'])localStorage.removeItem(AUTH_STORAGE_KEY+suffix);}catch{/* The signed-out interface is cleared even if storage is unavailable. */}
}
