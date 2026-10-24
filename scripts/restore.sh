#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
need python3; need sha256sum
archive=${1:-}
[[ -f $archive ]] || fail 'Usage: bash scripts/restore.sh /absolute/path/snapshot-....tar.gz [--extract]'
archive=$(realpath -- "$archive")
[[ -f $archive.sha256 ]] || fail 'Checksum sidecar missing.'
(cd "$(dirname -- "$archive")" && sha256sum -c "$(basename -- "$archive").sha256")
python3 - "$archive" "${2:-}" "$STACK_ROOT/backups" <<'PY'
import tarfile,pathlib,sys,tempfile,os,sqlite3,json,shutil
archive,mode,base=sys.argv[1:]
with tarfile.open(archive,'r:gz') as t:
    members=t.getmembers()
    roots=set()
    for m in members:
        p=pathlib.PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or not p.parts or not (m.isfile() or m.isdir()):
            raise SystemExit('Unsafe archive member: refusing restore')
        roots.add(p.parts[0])
    if len(roots)!=1: raise SystemExit('Archive must have one snapshot root')
    root=next(iter(roots))
    names={m.name for m in members}
    if root+'/manifest.json' not in names: raise SystemExit('Backup manifest missing')
    manifest=json.load(t.extractfile(root+'/manifest.json'))
    if manifest.get('format')!=1: raise SystemExit('Unsupported backup format')
    print('PASS: checksum, manifest and safe archive paths verified.')
    if mode=='--extract':
        os.umask(0o077)
        target=tempfile.mkdtemp(prefix='restore-review-',dir=base)
        for m in members:
            out=pathlib.Path(target)/m.name
            if m.isdir(): out.mkdir(parents=True,exist_ok=True,mode=0o700)
            else:
                out.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                with open(out,'xb') as f: shutil.copyfileobj(t.extractfile(m),f)
                out.chmod(0o600)
        for f in pathlib.Path(target).rglob('*'):
            if f.is_file():
                with open(f,'rb') as stream: isdb=stream.read(16)==b'SQLite format 3\0'
                if isdb:
                    db=sqlite3.connect(f.as_uri()+'?mode=ro',uri=True)
                    try:
                        if db.execute('PRAGMA quick_check').fetchone()[0]!='ok': raise SystemExit('Restored SQLite integrity check failed')
                    finally: db.close()
        print('Extracted and SQLite verified for review: '+target+'/'+root)
    elif mode: raise SystemExit('Only --extract is supported; live data is never overwritten')
print('Live services and files unchanged. Follow README_DEPLOY.md to stop, preserve current directories, and restore reviewed files manually.')
PY
