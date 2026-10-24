import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
process.umask(0o077);
export function snapshotTree(source,dest) {
  fs.mkdirSync(dest,{recursive:true,mode:0o700});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})) {
    const src=path.join(source,entry.name),dst=path.join(dest,entry.name);
    if(entry.isSymbolicLink()) throw new Error('Symlinks in persistent data need manual review');
    if(entry.isDirectory()) {snapshotTree(src,dst);continue;}
    if(!entry.isFile()) throw new Error('Unsupported special file in persistent data');
    if(/-(wal|shm)$/.test(entry.name)||/\.journal$/.test(entry.name)||entry.name.endsWith('-journal')) continue;
    const fd=fs.openSync(src,'r'),header=Buffer.alloc(16);
    try{fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}
    if(header.toString()==='SQLite format 3\0') {
      const db=new DatabaseSync(src,{readOnly:true});
      try {
        db.exec('PRAGMA busy_timeout=10000');
        db.prepare('VACUUM INTO ?').run(dst);
      } finally {db.close();}
      const check=new DatabaseSync(dst,{readOnly:true});
      try{if(Object.values(check.prepare('PRAGMA quick_check').get())[0]!=='ok')throw new Error('SQLite integrity check failed');}finally{check.close();}
    } else fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dst,0o600);
  }
}
if(process.argv[1]===import.meta.filename) {
  const name=process.argv[2];
  if(!/^snapshot-[0-9TZ-]+-[0-9]+$/.test(name||'')) throw new Error('Invalid snapshot name');
  const dest=path.join('/backups',name);
  fs.mkdirSync(dest,{mode:0o700});
  try {
    for(const dir of ['config','sessions','data/dashboard']) snapshotTree(path.join('/source',dir),path.join(dest,dir));
    fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({format:1,createdAt:new Date().toISOString(),method:'SQLite VACUUM INTO, individually consistent databases; not a cross-database transaction'},null,2));
    console.log('PASS: configuration and SQLite snapshots verified.');
  } catch(e) {console.error('Snapshot incomplete; staging retained for diagnosis. '+e.message);process.exitCode=1;}
}
