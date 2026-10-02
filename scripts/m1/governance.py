"""Small local M1 boundary check; no accounts, GitHub events or global hooks."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
assert package['main'] == 'src/m1/main.js'
assert package['version'] == '0.1.0' and package['private']
assert package['dependencies']['tokscale'] == '4.17.0'
assert package['build']['appId'] == 'local.agentusage.desktop.m1'
assert package['build']['publish'] is None
for relative in ['src/m1/main.js', 'src/m1/preload.js', 'src/m1/worker.js']:
    text = (root / relative).read_text(encoding='utf-8-sig')
    for forbidden in ['dotenv', 'autoUpdater', "require('../shared/collector')", 'codexAccounts', 'auth.json', 'discord.com', 'icloud']:
        assert forbidden not in text, (relative, forbidden)
assert 'TOKSCALE_PRICING_CACHE_ONLY' in (root / 'src/m1/native.js').read_text()
assert all((root / name).exists() for name in ['LICENSE', 'docs/m1/UPSTREAM.md', 'docs/m1/DATA-CONTRACT.md', 'docs/m1/ACCEPTANCE.md'])
print('PASS: frozen version, independent identity, product entry, no upstream account entry, local release boundary.')
