// Export the audited Git tree, never the raw working directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {auditRepository, git} from './check-publication.mjs';

const name = process.argv[2] || `rewards-stack-source-${new Date().toISOString().slice(0, 10)}`;
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(name) || process.argv.length > 3) throw Error('Provide one archive name using letters, digits, hyphens or underscores');
const root = git(['rev-parse', '--show-toplevel']).trim();
const audit = auditRepository(root);
if (!audit.ok) {
  for (const f of audit.findings) console.error(`${f.file}:${f.line}: ${f.rule}`);
  throw Error('Publication audit failed; no archive created');
}
if (git(['diff', '--name-only', '-z'], root)) throw Error('Tracked work files differ from the reviewed index; review and stage them first');
const output = path.join(root, 'dist');
if (fs.existsSync(output) && (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink())) throw Error('Unsafe dist directory');
fs.mkdirSync(output, {recursive: true});
const archive = path.join(output, `${name}.zip`), checksum = archive + '.sha256';
for (const file of [archive, checksum]) if (fs.existsSync(file)) throw Error('Output already exists; choose a new name');
const tree = git(['write-tree'], root).trim();
git(['archive', '--format=zip', `--output=${archive}`, tree], root);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(checksum, `${sha256}  ${path.basename(archive)}\n`, {flag: 'wx'});
console.log(`Created dist/${name}.zip from ${audit.files} audited files. No runtime data or Git metadata included.`);
console.log(`SHA256: ${sha256}`);
