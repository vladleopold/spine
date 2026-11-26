import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function resolveLegacyImagesDirectory({ projectDir, imagesDir, workspaceRoot, missingPath }) {
  const raw = String(missingPath || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (!raw || path.posix.isAbsolute(raw) || /^[a-z]:\//i.test(raw) || raw.startsWith('//')) {
    throw new Error('Unsupported absolute Spine images path; only project-relative paths can be safely rebound');
  }
  const projectRoot = path.resolve(projectDir);
  const imagesRoot = path.resolve(imagesDir);
  const workspace = path.resolve(workspaceRoot);
  const target = path.resolve(projectRoot, raw);
  const relative = path.relative(workspace, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Spine images path escapes the isolated export workspace');
  }
  if (target === imagesRoot || target.startsWith(imagesRoot + path.sep)) {
    throw new Error('Spine images path would create a recursive images link');
  }
  return target;
}

export function parseMissingImagesPaths(output = '') {
  return [...new Set([...String(output).matchAll(/Images path not found:\s*(.+?)\s*$/gim)]
    .map(match => match[1].trim()).filter(Boolean))];
}

function assertExistingAncestorInsideWorkspace(workspaceRoot, targetPath) {
  const workspace = fs.realpathSync(workspaceRoot);
  let ancestor = path.dirname(targetPath);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Cannot find a safe parent for the legacy Spine images path');
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  const relative = path.relative(workspace, realAncestor);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Legacy Spine images path traverses a symlink outside the isolated workspace');
  }
}

function bindUploadedImages({ projectDir, imagesDir, workspaceRoot, missingPath }) {
  const target = resolveLegacyImagesDirectory({ projectDir, imagesDir, workspaceRoot, missingPath });
  if (!fs.statSync(imagesDir).isDirectory() || fs.readdirSync(imagesDir).length === 0) {
    throw new Error('Uploaded images/ directory is empty; cannot bind the Spine project image path');
  }
  assertExistingAncestorInsideWorkspace(workspaceRoot, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const realParent = fs.realpathSync(path.dirname(target));
  const realWorkspace = fs.realpathSync(workspaceRoot);
  const parentRelative = path.relative(realWorkspace, realParent);
  if (parentRelative === '..' || parentRelative.startsWith('..' + path.sep) || path.isAbsolute(parentRelative)) {
    throw new Error('Legacy Spine images path parent escapes the isolated workspace');
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() && fs.realpathSync(target) === fs.realpathSync(imagesDir)) return target;
    throw new Error('Legacy Spine images path already exists and is not the uploaded images/ directory');
  }
  fs.symlinkSync(imagesDir, target, 'dir');
  return target;
}

/**
 * Export an original .spine project with the licensed Editor.
 * If the Editor reports a stale project-relative images path, bind that path
 * to the uploaded images/ directory inside this isolated job workspace and
 * rerun the export. The source .spine bytes are never modified.
 */
export function runLicensedSpineExport({ cli, project, output, images, workspaceRoot, license, timeoutMs = 180000, env = {} }) {
  if (!cli || !fs.statSync(cli).isFile()) throw new Error('Licensed Spine Editor CLI is unavailable');
  if (!license) throw new Error('Spine Editor license is unavailable');
  if (!fs.statSync(project).isFile()) throw new Error('Spine project file is missing');
  if (!fs.statSync(images).isDirectory()) throw new Error('Uploaded images/ directory is missing');

  const args = ['--update', '4.3.26', '--input', project, '--output', output, '--export', 'json+pack'];
  const execute = () => spawnSync(cli, args, {
    input: license + '\n',
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...env, LIBGL_ALWAYS_SOFTWARE: process.env.LIBGL_ALWAYS_SOFTWARE || '1' },
  });
  fs.mkdirSync(output, { recursive: true });
  let result = execute();
  let combined = String(result.stdout || '') + '\n' + String(result.stderr || '');
  let missing = parseMissingImagesPaths(combined);
  const remappedPaths = [];

  if (missing.length) {
    for (const missingPath of missing) {
      remappedPaths.push(bindUploadedImages({ projectDir: path.dirname(project), imagesDir: images, workspaceRoot, missingPath }));
    }
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    result = execute();
    combined = String(result.stdout || '') + '\n' + String(result.stderr || '');
    missing = parseMissingImagesPaths(combined);
    if (missing.length) throw new Error('Spine Editor still cannot resolve uploaded images/: ' + missing.join('; ').slice(0, 240));
  }

  if (result.error || result.status !== 0) {
    throw new Error('Spine Editor CLI export failed, exit ' + String(result.status ?? result.error?.message ?? 'unknown'));
  }
  return {
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    remappedPaths,
  };
}
