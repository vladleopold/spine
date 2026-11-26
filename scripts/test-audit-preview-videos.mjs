import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script=fileURLToPath(new URL('./audit-preview-videos.mjs',import.meta.url));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'spine-preview-fps-audit-'));
try {
  const library=path.join(root,'library');
  const bin=path.join(root,'bin');
  fs.mkdirSync(library,{recursive:true});
  fs.mkdirSync(bin);
  const entries=[
    {id:'valid',previewPath:'library/valid'},
    {id:'missing',previewPath:'library/missing'},
    {id:'short',previewPath:'library/short'},
    {id:'low-fps',previewPath:'library/low-fps'},
  ];
  fs.writeFileSync(path.join(library,'index.json'),JSON.stringify(entries,null,2));
  for(const id of ['valid','short','low-fps']){
    const dir=path.join(library,id);
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'preview.webm'),'fixture');
  }

  const ffprobe=path.join(bin,'ffprobe');
  fs.writeFileSync(ffprobe,'#!/bin/sh\nlast=""\nfor arg in "$@"; do last="$arg"; done\ncase "$last" in\n  *preview.repaired.webm*) kind=repaired ;;\n  *low-fps*) kind=low ;;\n  *short*) kind=short ;;\n  *) kind=valid ;;\nesac\ncase " $* " in\n  *" -count_frames "*) case "$kind" in short) echo 5 ;; low) echo 30 ;; *) echo 60 ;; esac ;;\n  *) case "$kind" in\n    short) printf \x27{"streams":[{"avg_frame_rate":"30/1","width":640,"height":480}],"format":{"duration":"0.2"}}\x27 ;;\n    low) printf \x27{"streams":[{"avg_frame_rate":"15/1","width":640,"height":480}],"format":{"duration":"2"}}\x27 ;;\n    *) printf \x27{"streams":[{"avg_frame_rate":"30/1","width":640,"height":480}],"format":{"duration":"2"}}\x27 ;;\n  esac ;;\nesac\n');
  fs.chmodSync(ffprobe,0o755);

  const ffmpeg=path.join(bin,'ffmpeg');
  fs.writeFileSync(ffmpeg,'#!/bin/sh\nfor arg in "$@"; do output="$arg"; done\nprintf "repaired-webm" > "$output"\n');
  fs.chmodSync(ffmpeg,0o755);

  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH};
  const audit=spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8'});
  assert.equal(audit.status,0,audit.stderr);
  const first=JSON.parse(fs.readFileSync(path.join(root,'preview-audit-report.json'),'utf8'));
  assert.equal(first.scanned,4);
  assert.equal(first.valid,1);
  assert.deepEqual(first.missing,['missing']);
  assert.ok(first.invalid.some(item=>item.id==='short'&&item.reason.includes('too short')));
  assert.ok(first.invalid.some(item=>item.id==='low-fps'&&item.reason.includes('manual inspection')));
  assert.equal(fs.readFileSync(path.join(library,'low-fps','preview.webm'),'utf8'),'fixture',
    'audit-only mode must never rewrite source media');

  const repair=spawnSync(process.execPath,[script,'--repair'],{cwd:root,env,encoding:'utf8'});
  assert.equal(repair.status,0,repair.stderr);
  const second=JSON.parse(fs.readFileSync(path.join(root,'preview-audit-report.json'),'utf8'));
  assert.equal(second.repaired.length,1,'only a decodable low-FPS video may be transcoded');
  assert.equal(second.repaired[0].id,'low-fps');
  assert.equal(second.repaired[0].after.fps,30);
  const updated=JSON.parse(fs.readFileSync(path.join(library,'index.json'),'utf8'));
  assert.equal(updated.find(item=>item.id==='low-fps').previewFps,30);
  assert.equal(fs.readFileSync(path.join(library,'low-fps','preview.webm'),'utf8'),'repaired-webm');
  console.log('PASS preview FPS audit: read-only by default, missing/short media classified, low-FPS repair verified before replacement');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}