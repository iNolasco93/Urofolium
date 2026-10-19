import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

function payload() {
  return { app: 'UroFolium', backupVersion: 3, createdAt: '2026-10-18T12:00:00.000Z',
    user: { supabaseUserId: 'account-a', email: 'a@example.test' },
    device: { platform: 'web', appVersion: '1.0.0', label: 'Synthetic' }, schema: { version: 3 },
    data: { procedures: [], stoneDetails: [] } };
}

async function harness() {
  const state = { owner: 'account-a', payload: payload(), filename: null, replaced: false, meta: {}, key: null, replacementError: false, changeDuringDecrypt: false };
  const modules = {
    '@capacitor/core': 'export const Capacitor={getPlatform:()=>"web"};',
    '../auth/authService': 'export const getCurrentUser=async()=>({id:"account-a",email:"a@example.test"}); export const fetchSupabaseProcedures=async()=>[];',
    '../db/procedureRepository': 'export const getAllProcedures=async()=>[];export const upsertProcedures=async()=>{};',
    '../db/stoneRepository': 'export const getAllStoneDetails=async()=>[];',
    '../db/database': `export const getDatabaseOwner=()=>state.owner;export const assertDatabaseOwner=(id)=>{if(id!==state.owner)throw Error('Account changed')};export const replaceDatabaseContents=async()=>{if(state.replacementError)throw Error('Storage failure');state.replaced=true;};`,
    '../db/metaRepository': 'export const getMeta=async()=>null; export const setMeta=async(key,value)=>{state.meta[key]=value;};',
    './cryptoService': 'export const getPassphrase=async()=>"synthetic-backup-passphrase";export const savePassphrase=async(value)=>{state.key=value;};export const generatePassphrase=()=>"synthetic-generated-key";export const encrypt=async()=>new Blob();export const decrypt=async()=>{if(state.changeDuringDecrypt)state.owner="account-b";return state.payload;};',
    '../google/driveService': 'export const downloadLatestBackup=async(name)=>{state.filename=name;return new Blob();};export const uploadFileToDrive=async()=>"file";export const rotateWeeklyBackup=async()=>{};export const findFileByName=async()=>null;',
    '../config/appConfig': 'export const APP_CONFIG={backupPrefix:"urofolium"};',
  };
  const compiled = await build({entryPoints:[resolve('src/backup/backupService.ts')],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'backup-adapters',setup(builder){
    builder.onResolve({filter:/.*/},args=>args.path in modules ? {path:args.path,namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));
  }}]});
  const module={exports:{}};
  runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,state,Blob,Date,Set,Map,Error});
  return { api: module.exports, state };
}

test('Drive restoration uses the UroFolium filename and replaces a validated backup', async()=>{
  const {api,state}=await harness();
  assert.equal(await api.restoreBackupNow(),0);
  assert.equal(state.filename,'urofolium-backup-latest.json.enc');
  assert.equal(state.replaced,true);
  assert.ok(state.meta.last_restore_at);
});

test('invalid backup is rejected before replacing any data or saving its key',async()=>{
  const {api,state}=await harness();state.payload.data.procedures=[{id:'broken'}];
  await assert.rejects(api.restoreBackupNow('new-backup-key'),/fecha|procedures/);
  assert.equal(state.replaced,false);assert.equal(state.key,null);assert.deepEqual(state.meta,{});
});

test('failed replacement does not publish success metadata or replace the saved key',async()=>{
  const {api,state}=await harness();state.replacementError=true;
  await assert.rejects(api.restoreBackupNow('new-backup-key'),/Storage failure/);
  assert.equal(state.replaced,false);assert.equal(state.key,null);assert.deepEqual(state.meta,{});
});

test('switching accounts during decryption cancels restoration before replacing data',async()=>{
  const {api,state}=await harness();state.changeDuringDecrypt=true;
  await assert.rejects(api.restoreBackupNow(),/Account changed/);
  assert.equal(state.replaced,false);assert.deepEqual(state.meta,{});
});
