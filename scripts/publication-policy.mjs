// Publication policy applies even to files added with git add -f.
export const publicRootFiles = new Set([
  '.gitignore', '.gitattributes', '.dockerignore', '.env.example',
  'README.md', 'README_DEPLOY.md', 'README_NAS.md', 'README_PUSHPLUS.md',
  'README_RELIABILITY.md', 'ACCOUNT_DELETE.md', 'WEB_LOGIN.md',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'UPSTREAM_LOCK.json',
  'compose.yaml', 'compose.source.yaml', 'package.json', 'package-lock.json',
]);
const directories = new Set(['docker', 'scripts', 'tests', 'dashboard-zh-CN', 'localization', 'docs', 'LICENSES']);
const extensions = new Set(['.sh', '.mjs', '.cjs', '.js', '.css', '.html', '.json', '.md', '.txt', '.yaml', '.py', '.ps1']);
const privateParts = new Set(['.git', '.test-work', 'reports', 'upstream', 'node_modules', 'config', 'sessions', 'data', 'backups', 'dist', '__pycache__']);

export function pathViolation(file) {
  if (file.includes('\\') || file.startsWith('/') || file.split('/').some(p => !p || p === '.' || p === '..')) return 'unsafe-path';
  const parts = file.split('/'), name = parts.at(-1);
  if (publicRootFiles.has(file)) return null;
  if (parts.some(p => privateParts.has(p))) return 'private-directory';
  if (parts.length < 2 || !directories.has(parts[0])) return 'unreviewed-root-entry';
  if (parts.some(p => p.startsWith('.')) || /(?:^id_(?:rsa|ed25519)|authorized_keys|known_hosts|credentials|storage[-_]?state|login\.txt)/i.test(name)) return 'private-filename';
  if (file.startsWith('scripts/') && (
    /^(?:nas-|check-nas-|inspect-nas-|validate-nas-|serve-|prepare-)/.test(name) && name !== 'nas-rewards-interface-check.cjs'
    || /^package-.*\.mjs$/.test(name) && name !== 'package-public.mjs'
    || ['manual-login.mjs', 'import-session.mjs'].includes(name)
  )) return 'historical-machine-helper';
  if (file.startsWith('tests/') && /-release\.py$/.test(name)) return 'historical-release-test';
  if (!name.startsWith('Dockerfile') && !extensions.has(name.slice(name.lastIndexOf('.')))) return 'unreviewed-file-type';
  return null;
}

const fixtureLiterals = new Set([
  '0123456789abcdef0123456789abcdef', 'existing-secret', 'new-secret',
  'original-secret', 'unrelated', 'keep-secret', 'old-new-secret',
  'replacement-secret', 'secret', 'secret\\0value', ' padded ', 'reserved',
  'a$#\\', 'private', 'private-cookie-never-log', 'invalid', 'untrusted', 'x\\n',
]);
const exampleEmail = value => /^(?:[\w.-]+\.)?(?:example\.(?:com|org|net|invalid)|invalid|test)$/i.test(value.split('@').at(-1));
function entropy(value) {
  const counts = new Map();
  for (const c of value) counts.set(c, (counts.get(c) || 0) + 1);
  return [...counts.values()].reduce((sum, n) => sum - n / value.length * Math.log2(n / value.length), 0);
}

export function inspectText(file, text) {
  const findings = [], seen = new Set();
  const add = (rule, index) => {
    const line = text.slice(0, index).split('\n').length, key = `${rule}:${line}`;
    if (!seen.has(key)) { findings.push({file, line, rule}); seen.add(key); }
  };
  const match = (rule, re, accept = () => false) => {
    for (const m of text.matchAll(re)) if (!accept(m)) add(rule, m.index);
  };
  if (text.includes('\0') || text.includes('\ufffd')) { add('binary-or-invalid-utf8', 0); return findings; }
  match('private-key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g);
  match('provider-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g);
  match('jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g);
  match('ssh-public-key', /ssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]{32,}/g);
  match('non-example-email', /[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}/g, m => exampleEmail(m[0]));
  match('non-loopback-ipv4', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    m => ['127.0.0.1', '0.0.0.0', '255.255.255.255'].includes(m[0]) || m[0].split('.').some(n => Number(n) > 255));
  match('personal-home-path', /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`]+|\/(?:home|Users)\/[^/\s"'`]+/g);
  match('credential-in-url', /https?:\/\/[^\s/'"<>]+:[^\s/'"<>]+@/g);
  const testFile = file.startsWith('tests/');
  const fixture = value => testFile && (fixtureLiterals.has(value) || /^(?:fixture-|unique-fixture-|managed-fixture-|private-webhook-test-)[\w$#-]+$/.test(value));
  match('literal-dotenv-credential', /^(?:export[ \t]+)?(?:API_TOKEN|DASHBOARD_PASSWORD|ACCOUNT_\d+_PASSWORD|PUSHPLUS_TOKEN|CLIENT_SECRET|PRIVATE_KEY)[ \t]*=[ \t]*([^\r\n]+)$/gm, m => {
    const value = m[1].trim();
    return !value || value.startsWith('#') || /^\$\{[A-Z_][A-Z0-9_]*(?::[-?][^}]*)?\}$/.test(value);
  });
  match('literal-credential', /(?:["'](?:password|passwd|api_?token|bot_?token|token|client_?secret|cookie|authorization|ACCOUNT_\d+_PASSWORD)["']|\b(?:password|passwd|api_?token|bot_?token|token|client_?secret|cookie|authorization|ACCOUNT_\d+_PASSWORD))\s*[:=]\s*(["'])([^\r\n]*?)\1/gi, m => {
    const value = m[2];
    if (!value || fixture(value)) return true;
    if (file === '.env.example' && ['optional-password'].includes(value)) return true;
    if (file.endsWith('.md') && value === '...') return true;
    if (/^(?:Bearer |Basic )$/.test(value)) return true;
    if (/^Bearer (?:invalid|intentionally-invalid-token)$/.test(value)) return true;
    return /^\$\{[A-Z_][A-Z0-9_]*(?::[-?][^}]*)?\}$/.test(value) || value === 'string' || /^[,\]\s]*$/.test(value) || /^\+crypto\.randomBytes\(/.test(value);
  });
  match('high-entropy-literal', /["'`]([A-Za-z0-9_+/=-]{28,})["'`]/g, m => {
    const value = m[1];
    if (fixture(value) || /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(value)) return true;
    if (file === 'package-lock.json' && /^sha(?:256|384|512)-/.test(value)) return true;
    return !/[A-Za-z]/.test(value) || !/\d/.test(value) || entropy(value) < 4.3;
  });
  return findings;
}
