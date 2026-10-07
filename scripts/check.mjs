import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=['ai.mjs','photo-prompts.mjs','server.mjs','serve.mjs','playwright.config.mjs',...(await readdir('scripts')).filter(n=>n.endsWith('.mjs')).map(n=>`scripts/${n}`),...(await readdir('dist')).filter(n=>n.endsWith('.js')).map(n=>`dist/${n}`)];
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
console.log(`Syntax checked ${files.length} application modules.`);
