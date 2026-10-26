import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(resolve(root,'extension/manifest.json'),'utf8'));
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,pkg.version);
assert.deepEqual(manifest.permissions,['activeTab','scripting','downloads','storage']);
assert.deepEqual([...manifest.host_permissions].sort(),['https://douyin.com/*','https://www.douyin.com/*']);
for(const script of manifest.content_scripts)for(const file of script.js)await readFile(resolve(root,'extension',file));
await readFile(resolve(root,'extension',manifest.background.service_worker));
await readFile(resolve(root,'extension',manifest.action.default_popup));
async function syntax(path){
  for(const file of await readdir(path,{withFileTypes:true})){
    if(['.git','node_modules','dist','__pycache__'].includes(file.name))continue;
    const target=resolve(path,file.name);
    if(file.isDirectory())await syntax(target);
    else if(/\.(?:m?js)$/.test(file.name)){
      const result=spawnSync(process.execPath,['--check',target],{encoding:'utf8'});
      if(result.status!==0)throw Error(result.stderr);
    }
  }
}
await syntax(root);
console.log('JavaScript syntax, manifest files, version consistency and permission boundaries passed.');
