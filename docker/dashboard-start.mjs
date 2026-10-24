import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
process.umask(0o077);
const {DASHBOARD_USERNAME:u, DASHBOARD_PASSWORD:p, CONTROL_API_TOKEN:t} = process.env;
if (!u || u.includes(':') || !p || p.length < 24 || !t || t.length < 32) {
  throw new Error('Dashboard requires a username, password >=24 characters, and Control API token >=32 characters.');
}
const dir = process.env.DATA_DIR || '/data';
fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
createRequire(import.meta.url)(path.join(process.cwd(), 'server.js'));
