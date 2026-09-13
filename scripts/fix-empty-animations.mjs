#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const indexPath = path.join(process.cwd(), 'library', 'index.json');

if (!fs.existsSync(indexPath)) {
  console.error('Index not found');
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
let fixed = false;

for (const entry of index) {
  const previewPath = entry.previewPath || path.posix.join('library', entry.id);
  const skeletonPath = path.join(process.cwd(), previewPath, entry.skeleton);
  
  if (!fs.existsSync(skeletonPath)) continue;
  
  const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  const animations = skeleton.animations || {};
  let hasEmptyAnim = false;
  
  for (const [animName, anim] of Object.entries(animations)) {
    if (!anim.timelines || anim.timelines.length === 0) {
      console.log(`Found empty animation: ${entry.id} -> ${animName}`);
      delete animations[animName];
      hasEmptyAnim = true;
    }
  }
  
  if (hasEmptyAnim) {
    // Check if any valid animations remain
    const remaining = Object.keys(animations).filter(name => animations[name].timelines?.length > 0);
    if (remaining.length === 0) {
      console.log(`No valid animations left for ${entry.id}, marking as invalid`);
      entry.invalid = true;
      entry.error = 'No valid animations (all timelines were empty)';
    }
    
    // Update skeleton file
    fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2));
    console.log(`Fixed skeleton: ${skeletonPath}`);
    fixed = true;
  }
}

if (fixed) {
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log('Updated index.json');
} else {
  console.log('No empty animations found');
}
