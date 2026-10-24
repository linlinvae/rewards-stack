import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {pathViolation, inspectText} from './publication-policy.mjs';

export function git(args, cwd = process.cwd(), options = {}) {
  return execFileSync('git', args, {cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options});
}

export function readIndex(cwd = process.cwd()) {
  const listing = git(['ls-files', '--stage', '-z'], cwd);
  const entries = listing.split('\0').filter(Boolean).map(record => {
    const m = /^(\d+) ([a-f0-9]+) (\d+)\t([\s\S]+)$/.exec(record);
    if (!m) throw Error('Cannot parse Git index');
    return {mode: m[1], oid: m[2], stage: Number(m[3]), file: m[4]};
  });
  const ids = [...new Set(entries.map(e => e.oid))];
  if (!ids.length) return [];
  const batch = git(['cat-file', '--batch'], cwd, {encoding: null, input: Buffer.from(ids.join('\n') + '\n')});
  const blobs = new Map(); let offset = 0;
  for (const id of ids) {
    const end = batch.indexOf(10, offset), header = batch.subarray(offset, end).toString('ascii');
    const m = /^([a-f0-9]+) blob (\d+)$/.exec(header);
    if (!m || m[1] !== id) throw Error('Unsupported Git object in index');
    const length = Number(m[2]); offset = end + 1;
    blobs.set(id, batch.subarray(offset, offset + length)); offset += length + 1;
  }
  return entries.map(e => ({...e, content: blobs.get(e.oid)}));
}

export function auditRepository(cwd = process.cwd()) {
  const entries = readIndex(cwd), findings = [];
  if (!entries.length) findings.push({file: '(index)', line: 0, rule: 'empty-index'});
  for (const entry of entries) {
    const violation = pathViolation(entry.file);
    if (violation) findings.push({file: entry.file, line: 0, rule: violation});
    if (entry.stage !== 0 || !['100644', '100755'].includes(entry.mode)) {
      findings.push({file: entry.file, line: 0, rule: 'symlink-submodule-or-conflict'}); continue;
    }
    if (entry.content.length > 3 * 1024 * 1024) {
      findings.push({file: entry.file, line: 0, rule: 'oversized-file'}); continue;
    }
    findings.push(...inspectText(entry.file, entry.content.toString('utf8')));
  }
  return {ok: findings.length === 0, files: entries.length, bytes: entries.reduce((n, e) => n + e.content.length, 0), findings};
}

function main() {
  const result = auditRepository();
  for (const hit of result.findings) console.error(`${hit.file}:${hit.line}: ${hit.rule}`);
  console.log(`${result.ok ? 'PASS' : 'FAIL'}: reviewed ${result.files} staged files (${result.bytes} bytes); ${result.findings.length} findings. Values are never printed.`);
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch { console.error('Publication audit could not read the Git index; initialize Git and stage the reviewed files first.'); process.exitCode = 1; }
}
