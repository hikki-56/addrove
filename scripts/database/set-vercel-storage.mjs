import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [name, valueArg, target='production']=process.argv.slice(2);
if(!['DATABASE_URL','STORAGE_DRIVER','STORAGE_MAINTENANCE','NEXT_PUBLIC_APP_URL','NEXTAUTH_URL'].includes(name))throw new Error('Unsupported environment variable');
if(!['production','preview','development'].includes(target))throw new Error('Unsupported target');
let value=valueArg;
if(name==='DATABASE_URL'){
  process.loadEnvFile('.env.supabase.local');
  value=process.env.DATABASE_URL;
}else if(name==='STORAGE_DRIVER' && !['sheets','postgres'].includes(value))throw new Error('Invalid storage driver');
else if(name==='STORAGE_MAINTENANCE' && !['0','1'].includes(value))throw new Error('Invalid maintenance flag');
else if(['NEXT_PUBLIC_APP_URL','NEXTAUTH_URL'].includes(name) && value!=='https://addrove.vercel.app')throw new Error('Unexpected application destination');
const cli=path.join(process.env.APPDATA,'npm/node_modules/vercel/dist/vc.js');
if(!fs.existsSync(cli))throw new Error('Vercel CLI is not installed');
const args=[cli,'env','add',name,target,'--force'];
if(name==='DATABASE_URL')args.push('--sensitive');
const result=spawnSync(process.execPath,args,{input:value,encoding:'utf8',windowsHide:true});
// The CLI never receives the credential in process arguments or terminal output.
process.stdout.write(result.stdout || '');process.stderr.write(result.stderr || '');
process.exitCode=result.status ?? 1;
