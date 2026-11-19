import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { clientConfiguration } from './src/client-config.ts';

export default defineConfig(({mode})=>{
  const env={...loadEnv(mode,process.cwd(),'VITE_'),...process.env};
  clientConfiguration(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY);
  return {plugins:[react(),tailwindcss()]};
});
