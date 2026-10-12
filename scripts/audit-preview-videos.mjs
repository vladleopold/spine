#!/usr/bin/env node
// Audit every indexed Spine preview. Repair only decodable, genuine-motion WebM
// files; never manufacture motion from a still or a five-frame clip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listCollectionFolders, readIndex } from './resolve-library.mjs';

const root = process.cwd();
const repair = process.argv.includes('--repair');
const minFps = 30;
const minDuration = 0.5;
const report = { scanned: 0, valid: 0, repaired: [], missing: [], invalid: [], errors: [] };
function probe(file) {
  const raw = execFileSync('ffprobe', ['-v','error','-select_streams','v:0',
    '-show_entries','stream=avg_frame_rate,nb_frames,width,height:format=duration',
    '-of','json',file], {encoding:'utf8'});
  const data = JSON.parse(raw);
  const stream = data.streams?.[0] || {};
  const [num,den] = String(stream.avg_frame_rate || '0/0').split('/').map(Number);
  const fps = den > 0 ? num / den : 0;
  const duration = Number(data.format?.duration) || 0;
  // Count decoded frames rather than trusting WebM's often missing nb_frames.
  const countRaw = execFileSync('ffprobe',['-v','error','-select_streams','v:0',
    '-count_frames','-show_entries','stream=nb_read_frames','-of','default=nw=1:nk=1',file],{encoding:'utf8'}).trim();
  const frames = Number(countRaw) || 0;
  return { fps, duration, frames, width:Number(stream.width)||0, height:Number(stream.height)||0 };
}
function valid(v) { return v.duration >= minDuration && v.frames > 5 && v.fps >= minFps - 0.1; }
for (const folder of listCollectionFolders(root)) {
  const entries = readIndex(root,folder);
  if (!Array.isArray(entries)) continue;
  let changed = false;
  for (const entry of entries) {
    if (!entry?.id) continue;
    report.scanned++;
    const dir = path.resolve(root,entry.previewPath || path.posix.join(folder,entry.id));
    if (!dir.startsWith(root + path.sep)) { report.errors.push({id:entry.id,error:'unsafe path'}); continue; }
    const file = path.join(dir,'preview.webm');
    if (!fs.existsSync(file)) { report.missing.push(entry.id); continue; }
    try {
      let info = probe(file);
      if (valid(info)) { report.valid++; continue; }
      if (info.duration < minDuration || info.frames <= 5) {
        report.invalid.push({id:entry.id,...info,reason:'too short or too few frames; re-export from Spine source'});
        continue;
      }
      if (!repair || info.fps >= minFps - 0.1) {
        report.invalid.push({id:entry.id,...info,reason:'requires source re-export or manual inspection'});
        continue;
      }
      const tmp = path.join(dir,'preview.repaired.webm');
      try {
        execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,
          '-vf','fps=30','-an','-c:v','libvpx-vp9','-b:v','0','-crf','28',
          '-deadline','good','-cpu-used','2',tmp],{stdio:'pipe',timeout:300000});
        const checked = probe(tmp);
        if (!valid(checked)) throw new Error('post-transcode verification failed');
        fs.renameSync(tmp,file);
        entry.previewFrameCount = checked.frames;
        entry.previewDuration = checked.duration;
        entry.previewFps = checked.fps;
        changed = true;
        report.repaired.push({id:entry.id,before:info,after:checked});
      } finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    } catch(error) { report.errors.push({id:entry.id,error:String(error.message||error).slice(0,300)}); }
  }
  if (changed) fs.writeFileSync(path.join(root,folder,'index.json'),JSON.stringify(entries,null,2)+'\n');
}
fs.writeFileSync('preview-audit-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scanned:report.scanned,valid:report.valid,repaired:report.repaired.length,
 missing:report.missing.length,invalid:report.invalid.length,errors:report.errors.length}));
if (report.errors.length) process.exitCode = 1;
