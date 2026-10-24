"""Execute the actual embedded restore validator on isolated archives."""
import pathlib, tempfile, tarfile, io, json, subprocess, sys, ast, sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
(root / '.test-work').mkdir(exist_ok=True)
work = pathlib.Path(tempfile.mkdtemp(prefix='restore-test-', dir=root / '.test-work'))
source = (root / 'scripts/restore.sh').read_text(encoding='utf-8')
code = source.split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
for file in ['scripts/preflight.sh', 'scripts/restore.sh']:
    body = (root / file).read_text(encoding='utf-8').split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
    ast.parse(body)

def archive(name, extra=None):
    dest = work / name
    with tarfile.open(dest, 'w:gz') as t:
        blob = json.dumps({'format': 1}).encode()
        m = tarfile.TarInfo('snapshot-test/manifest.json'); m.size = len(blob)
        t.addfile(m, io.BytesIO(blob))
        t.add(work / 'fixture.sqlite', arcname='snapshot-test/data/dashboard/dashboard.sqlite')
        if extra:
            m = tarfile.TarInfo(extra[0])
            if extra[1] == 'link': m.type = tarfile.SYMTYPE; m.linkname = '../../outside'
            t.addfile(m)
    return dest

results = []
dbfile = work / 'fixture.sqlite'
db = sqlite3.connect(dbfile)
db.execute('CREATE TABLE fixture(value TEXT)')
db.execute("INSERT INTO fixture VALUES ('preserved')")
db.commit(); db.close()
for name, extra, expected in [('valid.tar.gz', None, 0), ('traversal.tar.gz', ('snapshot-test/../../outside', 'file'), 1), ('link.tar.gz', ('snapshot-test/link', 'link'), 1)]:
    f = archive(name, extra)
    r = subprocess.run([sys.executable, '-c', code, str(f), '', str(work)], capture_output=True, text=True)
    assert (r.returncode == 0) == (expected == 0), r.stderr
    results.append({'name': name, 'status': 'PASS'})
valid = work / 'valid.tar.gz'
r = subprocess.run([sys.executable, '-c', code, str(valid), '--extract', str(work)], capture_output=True, text=True)
assert r.returncode == 0, r.stderr
assert list(work.glob('restore-review-*/snapshot-test/manifest.json'))
restored = next(work.glob('restore-review-*/snapshot-test/data/dashboard/dashboard.sqlite'))
db = sqlite3.connect(restored.as_uri() + '?mode=ro', uri=True)
assert db.execute('SELECT value FROM fixture').fetchone()[0] == 'preserved'
db.close()
assert not (root / 'sessions/sessions.db').exists()
results.append({'name': 'extract to new review directory only', 'status': 'PASS'})
(root / 'reports').mkdir(exist_ok=True)
(root / 'reports/restore-tests.json').write_text(json.dumps({'scope': 'Embedded Python validator only; Linux shell/checksum/service steps need server validation', 'results': results}, indent=2) + '\n')
print('PASS: embedded Python syntax, restore validation, path/link rejection and non-destructive extraction')
