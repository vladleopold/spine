#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const indexPath = path.join(process.cwd(), 'library', 'index.json');
if (!fs.existsSync(indexPath)) {
  console.error('Index not found');
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
let hasChanges = false;
const fixedIds = [];

for (const entry of index) {
  const previewPath = entry.previewPath || path.posix.join('library', entry.id);
  const skeletonPath = path.join(process.cwd(), previewPath, entry.skeleton);
  
  if (!fs.existsSync(skeletonPath)) continue;
  
  try {
    const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
    const animations = skeleton.animations || {};
    let hasFix = false;
    
    // Fix 1: Remove animations with 0 timelines
    for (const [animName, anim] of Object.entries(animations)) {
      if (!anim.timelines || anim.timelines.length === 0) {
        console.log(`Removing empty animation: ${entry.id} -> ${animName}`);
        delete animations[animName];
        hasFix = true;
      }
    }
    
    // Fix 2: Remove timelines with undefined/invalid type
    for (const [animName, anim] of Object.entries(animations)) {
      if (anim.timelines) {
        const originalLength = anim.timelines.length;
        anim.timelines = anim.timelines.filter(t => 
          t.type && t.type !== 'undefined' && t.type !== ''
        );
        if (anim.timelines.length !== originalLength) {
          console.log(`Removed ${originalLength - anim.timelines.length} invalid timelines from ${entry.id} -> ${animName}`);
          hasFix = true;
        }
      }
    }
    
    // Fix 3: Remove animations that became empty after timeline cleanup
    for (const [animName, anim] of Object.entries(animations)) {
      if (!anim.timelines || anim.timelines.length === 0) {
        console.log(`Removing now-empty animation: ${entry.id} -> ${animName}`);
        delete animations[animName];
        hasFix = true;
      }
    }
    
    // Fix 3: Fix atlas texture paths (remove ../textures/ prefix)
    if (entry.atlas) {
      const atlasPath = path.join(process.cwd(), previewPath, entry.atlas);
      if (fs.existsSync(atlasPath)) {
        let atlasContent = fs.readFileSync(atlasPath, 'utf8');
        const originalAtlas = atlasContent;
        // Fix texture paths in atlas: remove ../textures/ prefix
        atlasContent = atlasContent.replace(/\.\.\/textures\//g, '');
        if (atlasContent !== originalAtlas) {
          fs.writeFileSync(atlasPath, atlasContent);
          console.log(`Fixed atlas texture paths: ${atlasPath}`);
          hasFix = true;
        }
      }
    }
    
    if (hasFix) {
      fs.writeFileSync(path.join(process.cwd(), previewPath, entry.skeleton), JSON.stringify(skeleton, null, 2));
      console.log(`Fixed skeleton: ${entry.id}`);
      hasChanges = true;
      fixedIds.push(entry.id);
    }
  } catch (e) {
    console.error(`Error processing ${entry.id}:`, e.message);
  }
}

// Output for GitHub Actions
console.log(`::set-output name=changes::${hasChanges}`);
console.log(`::set-output name=fixedIds::${JSON.stringify(fixedIds)}`);
