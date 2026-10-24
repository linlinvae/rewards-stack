import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawnSync} from 'node:child_process';
import {auditRepository} from '../scripts/check-publication.mjs';
import {inspectText, pathViolation} from '../scripts/publication-policy.mjs';

const auditScript = path.resolve('scripts/check-publication.mjs');
const packScript = path.resolve('scripts/package-public.mjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rewards-publication-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('rewards-publication-'));
    fs.rmSync(directory, {recursive: true, force: true});
  });
  const git = (...args) => execFileSync('git', args, {cwd: directory, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  const write = (name, content) => {const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content);};
  return {directory, git, write};
}
const passwordName = ['pass', 'word'].join('');
const credential = ['AuditOnly', '9kQ7vZ4rP6tX8bW2mN5cL3sF'].join('-');
const secretLine = () => `${passwordName}=${JSON.stringify(credential)};\n`;

test('Audit examines staged content even when a secret is removed from the work file', t => {
  const f = fixture(t);
  f.write('README.md', secretLine()); f.git('add', 'README.md');
  f.write('README.md', '# Clean work file\n');
  const result = auditRepository(f.directory);
  assert(!result.ok); assert(result.findings.some(x => x.rule === 'literal-credential'));
  const cli = spawnSync(process.execPath, [auditScript], {cwd: f.directory, encoding: 'utf8', windowsHide: true});
  assert.equal(cli.status, 1); assert(!(cli.stdout + cli.stderr).includes(credential));
});

test('Force-added private paths, binary content and links are rejected', t => {
  const f = fixture(t);
  f.write('.env', 'PRIVATE=1\n'); f.write('docs/binary.md', Buffer.from([0, 1, 2]));
  f.git('add', '-f', '.env', 'docs/binary.md');
  const oid = f.git('hash-object', '-w', '--stdin'); // Empty target still exercises the Git symlink mode.
  f.git('update-index', '--add', '--cacheinfo', `120000,${oid.trim()},scripts/link.mjs`);
  const result = auditRepository(f.directory);
  for (const rule of ['unreviewed-root-entry', 'binary-or-invalid-utf8', 'symlink-submodule-or-conflict']) assert(result.findings.some(x => x.rule === rule));
});

test('Identity and provider-secret detection also applies to test sources', () => {
  const email = ['someone', '@', 'mail.example-real.com'].join('');
  const ipv4 = ['203', '0', '113', '7'].join('.');
  const key = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const token = ['ghp', '_', 'aB9cD8eF7gH6iJ5k', 'L4mN3pQ2rS1tU0vW'].join('');
  const hits = inspectText('tests/fixture.mjs', [email, ipv4, key, token].join('\n'));
  for (const rule of ['non-example-email', 'non-loopback-ipv4', 'private-key', 'provider-token']) assert(hits.some(x => x.rule === rule));
  assert.deepEqual(inspectText('tests/fixture.mjs', "const token='0123456789abcdef0123456789abcdef';\nconst email='fixture@example.invalid';"), []);
  assert(inspectText('.env.example', ['API_TOKEN', credential].join('=')).some(x => x.rule === 'literal-dotenv-credential'));
  assert.deepEqual(inspectText('.env.example', 'API_TOKEN=\nDASHBOARD_USERNAME=admin\nDASHBOARD_PASSWORD=\n'), []);
  assert(pathViolation('scripts/nas-ssh-setup.sh'));
  assert(pathViolation('reports/result.json'));
});

test('Packaging exports only the audited index, excludes ignored local files, and preserves old outputs', t => {
  const f = fixture(t);
  f.write('README.md', '# Reviewed source\n'); f.write('LICENSE', 'Test fixture license\n');
  f.write('.gitignore', '/.env\n/reports/\n/dist/\n');
  f.git('add', '.');
  f.write('.env', secretLine()); f.write('reports/private.txt', credential);
  const run = () => spawnSync(process.execPath, [packScript, 'review-test'], {cwd: f.directory, encoding: 'utf8', windowsHide: true});
  const packed = run(); assert.equal(packed.status, 0, packed.stderr);
  const archive = path.join(f.directory, 'dist/review-test.zip');
  const contents = execFileSync('tar', ['-tf', archive], {encoding: 'utf8', windowsHide: true}).trim().split(/\r?\n/).sort();
  assert.deepEqual(contents, ['.gitignore', 'LICENSE', 'README.md']);
  assert.equal(run().status, 1);
  f.write('README.md', '# Unreviewed modification\n');
  const dirty = spawnSync(process.execPath, [packScript, 'dirty-test'], {cwd: f.directory, encoding: 'utf8', windowsHide: true});
  assert.equal(dirty.status, 1); assert(!fs.existsSync(path.join(f.directory, 'dist/dirty-test.zip')));
});
