// doc-sync link and anchor checking (T-06), offline and repo-relative only.
const { spawnSync } = require('child_process');
const path = require('path');
const { createRepo, writeFile, removeRepo } = require('./helpers');

const scriptPath = path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'links.js');
const links = require(scriptPath);

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = createRepo('docsync-links-');
writeFile(repo.root, 'src/textutil.js', 'x\n');
writeFile(repo.root, 'docs/other.md', '# Other Doc\n\n## Usage & Tips!\n\n## Repeat\n\n## Repeat\n');
writeFile(repo.root, 'README.md', [
    '# Demo',
    '',
    '## Good links',
    '',
    'See [guide](docs/other.md), [anchor](docs/other.md#usage--tips), [dup](docs/other.md#repeat-1),',
    '[self](#good-links), [source](src/textutil.js#L3) and [ref][r1].',
    'External [site](https://example.com/nope) and [mail](mailto:a@b.c) are ignored. `[code](docs/missing.md)` too.',
    '',
    '[r1]: docs/other.md#other-doc',
    '',
    '## Broken links',
    '',
    'Bad [file](docs/missing.md), bad [anchor](docs/other.md#no-such-heading), bad [self](#nowhere),',
    'bad [escape](../outside.md) and bad [rootless](/docs/gone.md).',
    '',
    '```',
    '[fenced](docs/also-missing.md)',
    '```',
    '',
    '## Third',
    '',
    '[later](docs/third-missing.md)',
].join('\n'));

const good = links.checkLinks('README.md', { root: repo.root, sections: ['Good links'] });
check('FR-06: valid file, anchor, duplicate-heading, self and reference links all resolve', good.broken.length === 0 && good.checked === 6);
check('NFR-02: external URLs are ignored (no network)', !good.broken.some((b) => b.target.startsWith('http')) && good.checked === 6);
check('FR-06: links inside inline code are ignored', !good.broken.some((b) => b.target.includes('missing.md')));

const bad = links.checkLinks('README.md', { root: repo.root, sections: ['Broken links'] });
const reasonFor = (target) => (bad.broken.find((b) => b.target === target) || {}).reason;
check('FR-06: injected broken file link is reported', reasonFor('docs/missing.md') === 'file not found');
check('FR-06: broken anchor is reported', reasonFor('docs/other.md#no-such-heading') === 'anchor not found');
check('FR-06: broken same-file anchor is reported', reasonFor('#nowhere') === 'anchor not found');
check('NFR-02: link escaping the repository is reported', reasonFor('../outside.md') === 'target is outside the repository');
check('FR-06: root-relative link to a missing file is reported', reasonFor('/docs/gone.md') === 'file not found');
check('FR-06: links inside code fences are ignored', !bad.broken.some((b) => b.target.includes('also-missing')));
check('FR-06: broken links carry their line numbers', bad.broken.every((b) => b.line >= 13 && b.line <= 15));
check('NFR-05: only the requested section is checked', !bad.broken.some((b) => b.target.includes('third-missing')) && !good.broken.some((b) => b.target.includes('third-missing')));

const whole = links.checkLinks('README.md', { root: repo.root });
check('FR-06: without sections the whole file is checked', whole.broken.some((b) => b.target === 'docs/third-missing.md') && whole.broken.length === 6);
check('FR-06: missing section is reported as broken', links.checkLinks('README.md', { root: repo.root, sections: ['Nope'] }).broken.length === 1);

check('FR-06: GitHub slug rules for punctuation and spaces', links.slugify('Usage & Tips!') === 'usage--tips' && links.slugify('`code` Name') === 'code-name');

const cli = (...args) => spawnSync('node', [scriptPath, ...args], { cwd: repo.root, env: { ...process.env, CLAUDE_PROJECT_DIR: repo.root }, encoding: 'utf8' });
check('FR-06: CLI exits 0 for a clean section', cli('README.md', '--section', 'Good links').status === 0);
const cliBad = cli('README.md', '--section', 'Broken links');
check('FR-06: CLI exits 1 and prints broken links for a bad section', cliBad.status === 1 && JSON.parse(cliBad.stdout).broken.length === 5);
check('FR-06: CLI without a file is a usage error', cli().status === 2);

removeRepo(repo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC LINKS TESTS PASSED' : failures + ' DOC-SYNC LINKS TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
