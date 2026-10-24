"""Restore WAL/SHM ownership to their database owner after root backup checks.

No database contents or file paths outside the stack persistent directories change.
"""
import os
import pathlib
import stat
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
assert root == pathlib.Path('/volume1/rewards-stack-nas') or (root / 'compose.yaml').is_file()
for relative in ['sessions', 'data/dashboard']:
    directory = root / relative
    assert directory.is_dir() and not directory.is_symlink()
    for database in directory.rglob('*'):
        if database.is_symlink():
            raise SystemExit('Symlink in SQLite storage; no permission changes allowed')
        if not database.is_file():
            continue
        with database.open('rb') as source:
            if source.read(16) != b'SQLite format 3\0':
                continue
        owner = database.stat()
        for suffix in ['-wal', '-shm']:
            helper = pathlib.Path(str(database) + suffix)
            if not os.path.lexists(helper):
                continue
            info = helper.lstat()
            assert stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'Unsafe SQLite helper'
            if (info.st_uid, info.st_gid) != (owner.st_uid, owner.st_gid):
                os.chown(helper, owner.st_uid, owner.st_gid, follow_symlinks=False)
            os.chmod(helper, 0o600, follow_symlinks=False)
print('PASS: SQLite WAL/SHM ownership matches database files; contents retained')
