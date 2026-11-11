"""Small local M1 boundary check; no accounts, GitHub events or global hooks."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
lock = json.loads((root / 'package-lock.json').read_text(encoding='utf-8'))
assert package['main'] == 'src/quota/main.js'
assert package['private'] is True
assert package['version'] == lock['version'] == lock['packages']['']['version']
assert package['dependencies']['tokscale'] == '4.17.0'
assert package['build']['appId'] == 'local.agentusage.quota'
# Application updates travel over electron-updater from the project's own GitHub Releases (docs/m2/AUTO-UPDATE-20261108.md);
# the owner and repository are fixed here so a build cannot be pointed at somebody else's release feed.
publish = package['build']['publish']
assert isinstance(publish, list) and len(publish) == 1, publish
assert publish[0]['provider'] == 'github' and publish[0]['owner'] == 'ydan120980-source' and publish[0]['repo'] == 'token', publish
assert set(package['dependencies']) == {'@modelcontextprotocol/sdk', 'electron-updater', 'sql.js', 'tokscale'}
for relative in ['src/m1/service.js', 'src/m1/worker.js']:
    text = (root / relative).read_text(encoding='utf-8-sig')
    for forbidden in ['dotenv', 'autoUpdater', "require('../shared/collector')", 'codexAccounts', 'auth.json', 'discord.com', 'icloud']:
        assert forbidden not in text, (relative, forbidden)
assert 'TOKSCALE_PRICING_CACHE_ONLY' in (root / 'src/m1/native.js').read_text()
assert all((root / name).exists() for name in ['LICENSE', 'docs/m1/UPSTREAM.md', 'docs/m1/DATA-CONTRACT.md', 'docs/m1/ACCEPTANCE.md'])
assert 'cli_auth_credentials_store="keyring"' in (root / 'src/quota/rpc.js').read_text()
assert not (root / 'src/m1/main.js').exists()
print('PASS: unified entry, frozen runtime, minimal dependencies, offline collector and independent keyring quota boundary.')
