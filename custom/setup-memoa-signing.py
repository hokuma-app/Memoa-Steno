#!/usr/bin/env python3
"""Create the explicitly approved local Memoa Test signing identity once."""
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

IDENTITY = 'Memoa Test Local Signing'
KEYCHAIN = Path.home() / 'Library/Keychains/login.keychain-db'


def run(args):
    subprocess.run(args, check=True)


def main():
    found = subprocess.run(['security', 'find-certificate', '-c', IDENTITY, str(KEYCHAIN)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if found.returncode == 0:
        print('Existing Memoa Test certificate retained; no replacement performed.')
        run(['security', 'find-identity', '-v', '-p', 'codesigning', str(KEYCHAIN)])
        return
    old_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix='memoa-signing-', dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            cfg, key, cert, p12, password = [root / n for n in ['openssl.cnf', 'key.pem', 'cert.pem', 'identity.p12', 'password']]
            cfg.write_text('[req]\ndistinguished_name = dn\nx509_extensions = signing\nprompt = no\n'
                           '[dn]\nCN = ' + IDENTITY + '\n[signing]\nbasicConstraints = critical,CA:FALSE\n'
                           'keyUsage = critical,digitalSignature\nextendedKeyUsage = critical,codeSigning\n'
                           'subjectKeyIdentifier = hash\n')
            passphrase = secrets.token_hex(32)
            password.write_text(passphrase)
            run(['/usr/bin/openssl', 'req', '-new', '-newkey', 'rsa:3072', '-nodes', '-x509', '-sha256',
                 '-days', '3650', '-config', str(cfg), '-keyout', str(key), '-out', str(cert)])
            run(['/usr/bin/openssl', 'pkcs12', '-export', '-inkey', str(key), '-in', str(cert),
                 '-name', IDENTITY, '-out', str(p12), '-passout', 'file:' + str(password)])
            # Only codesign is authorized; never use -A or change all-key partition ACLs.
            result = subprocess.run(['security', 'import', str(p12), '-k', str(KEYCHAIN),
                                     '-P', passphrase, '-T', '/usr/bin/codesign'], capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError('Keychain identity import failed; no credential values are reported')
            print('Imported Memoa Test identity; requesting user-level code-signing trust.', flush=True)
            run(['security', 'add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign',
                 '-k', str(KEYCHAIN), str(cert)])
    finally:
        os.umask(old_umask)
    run(['security', 'find-identity', '-v', '-p', 'codesigning', str(KEYCHAIN)])


if __name__ == '__main__':
    main()
