"""Small local M1 boundary check; no accounts, GitHub events or global hooks."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
assert package['main'] == 'src/quota/main.js'
assert package['version'] == '0.1.0' and package['private']
assert package['dependencies']['tokscale'] == '4.17.0'
assert package['build']['appId'] == 'local.agentusage.quota'
assert package['build']['publish'] is None
assert set(package['dependencies']) == {'sql.js', 'tokscale'}
for relative in ['src/m1/service.js', 'src/m1/worker.js']:
    text = (root / relative).read_text(encoding='utf-8-sig')
    for forbidden in ['dotenv', 'autoUpdater', "require('../shared/collector')", 'codexAccounts', 'auth.json', 'discord.com', 'icloud']:
        assert forbidden not in text, (relative, forbidden)
assert 'TOKSCALE_PRICING_CACHE_ONLY' in (root / 'src/m1/native.js').read_text()
assert all((root / name).exists() for name in ['LICENSE', 'docs/m1/UPSTREAM.md', 'docs/m1/DATA-CONTRACT.md', 'docs/m1/ACCEPTANCE.md'])
assert 'cli_auth_credentials_store="keyring"' in (root / 'src/quota/rpc.js').read_text()
assert not (root / 'src/m1/main.js').exists()
print('PASS: unified entry, frozen runtime, minimal dependencies, offline collector and independent keyring quota boundary.')
