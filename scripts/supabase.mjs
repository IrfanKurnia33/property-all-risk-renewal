import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

for (const file of ['.env.local', '.env.supabase.local']) if (existsSync(file)) process.loadEnvFile(file);
const args = process.argv.slice(2);
const secrets = Object.entries(process.env).filter(([key, value]) => value && /TOKEN|PASSWORD|SECRET|SERVICE_ROLE|PUBLISHABLE_KEY/.test(key)).map(([, value]) => value);
function redact(value) {
  let output = String(value);
  for (const secret of secrets) output = output.split(secret).join('[redacted]');
  return output.replace(/\b(?:sbp_|sb_secret_)[A-Za-z0-9_.-]+/g, '[redacted]').replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://[redacted]@');
}
try {
  const url = new URL(process.env.VITE_SUPABASE_URL ?? '');
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) throw new Error('A valid hosted Supabase URL is required.');
  const projectRef = url.hostname.split('.')[0];
  for (let i=0;i<args.length;i++) {
    if(args[i]==='--workdir' || args[i].startsWith('--workdir=') || args[i]==='--profile' || args[i].startsWith('--profile=')) throw new Error('Use the repository-local CLI configuration.');
    if(args[i].startsWith('--remote=') && args[i].slice(9)!==projectRef) throw new Error('Remote target must match the verified project.');
    if(args[i]==='--project-ref' && args[i+1]!==projectRef) throw new Error('Project reference must match the verified project.');
  }
  if (args[0] !== 'init' && !args.includes('--help') && !args.includes('--version')) {
    const response = await fetch('https://api.supabase.com/v1/projects/' + projectRef, { headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Project verification failed (HTTP ' + response.status + ').');
    const project = await response.json();
    if (project.id !== projectRef || project.name !== 'rekonvia-db' || project.region !== 'ap-southeast-1') throw new Error('Refusing an unexpected project, name, or region.');
    console.log('Verified target: ' + project.name + ' / ' + projectRef + ' / ' + project.region);
    if (existsSync('supabase/.temp/project-ref') && readFileSync('supabase/.temp/project-ref', 'utf8').trim() !== projectRef) throw new Error('The CLI is linked to a different project.');
  }
  if (args[0] === 'verify') process.exit(0);
  if (args[0] === 'link' && !args.includes('--project-ref')) args.push('--project-ref', projectRef);
  const entrypoint = resolve('node_modules/supabase/dist/supabase.js');
  const child = spawn(process.execPath, [entrypoint, ...args], { env: { ...process.env, XDG_CACHE_HOME: resolve('.cache'), SUPABASE_HOME: resolve('.cache/supabase-home'), SUPABASE_NO_UPDATE_NOTIFIER: '1', SUPABASE_TELEMETRY_DISABLED: 'true', DO_NOT_TRACK: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output='',errors='';
  child.stdout.on('data', chunk => { output+=String(chunk); if(output.length>4_000_000)child.kill(); });
  child.stderr.on('data', chunk => { errors+=String(chunk); if(errors.length>4_000_000)child.kill(); });
  child.on('error', error => { console.error(redact(error.message)); process.exitCode = 1; });
  child.on('close', code => { process.stdout.write(redact(output)); process.stderr.write(redact(errors)); process.exitCode = code ?? 1; });
} catch (error) { console.error(redact(error instanceof Error ? error.message : error)); process.exitCode = 1; }
