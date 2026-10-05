// doc-sync fixtures: baseline/scenario repos drive discovery and link checking (T-14).
const fs = require('fs');
const path = require('path');
const { removeRepo } = require('./helpers');
const { buildScenarioRepo, SCENARIOS } = require('./fixtures/doc-sync/build.js');
const discover = require(path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'discover.js'));
const links = require(path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'links.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const isSignatureMention = (reference) => /\w\(/.test(reference.text) || reference.text.startsWith('#');
const vagueCandidates = (references, symbolNames) => references.filter((reference) => reference.kind === 'symbol' && symbolNames.includes(reference.reference) && !isSignatureMention(reference));

const repos = SCENARIOS.map(buildScenarioRepo);
const [signatureRepo, noImpactRepo, brokenLinkRepo] = repos;
const legacyPath = 'docs/legacy-notes.md';
const legacyOriginal = fs.readFileSync(path.join(signatureRepo.root, legacyPath), 'utf8');

const result = discover.discoverAll(signatureRepo.root, {});
const changedNames = result.symbols.changed.map((symbol) => symbol.name);
const staleCandidates = result.symbols.changed.filter((symbol) => result.references.some((reference) => reference.kind === 'symbol' && reference.reference === symbol.name && reference.doc !== 'src/textutil.js'));
check('FR-02: baseline and scenario produce one changed file set', JSON.stringify(result.changedFiles) === JSON.stringify(['src/textutil.js']));
check('FR-03: exactly one STALE candidate, the truncate signature change', staleCandidates.length === 1 && staleCandidates[0].name === 'truncate' && staleCandidates[0].previousSignature === '(text, max)' && staleCandidates[0].signature === '(text, max, options = {})');
check('FR-03: both README and docs/textutil.md reference the changed signature', ['README.md', 'docs/textutil.md'].every((doc) => result.references.some((reference) => reference.doc === doc && reference.reference === 'truncate' && /truncate\(text, max\)/.test(reference.text))));
check('FR-03: exactly one MISSING candidate, the undocumented wordCount', result.undocumented.length === 1 && result.undocumented[0].name === 'wordCount');
const ambiguous = vagueCandidates(result.references, changedNames);
check('FR-04: exactly one AMBIGUOUS candidate, the vague sentence about truncate', ambiguous.length === 1 && ambiguous[0].doc === 'docs/textutil.md' && ambiguous[0].text.includes('sensibly'));
check('FR-08: the unrelated stale document is not reported', result.references.every((reference) => reference.doc !== legacyPath) && !result.changedFiles.includes(legacyPath));
check('FR-08: the unrelated stale document is untouched', fs.readFileSync(path.join(signatureRepo.root, legacyPath), 'utf8') === legacyOriginal);
check('NFR-06: the fixture change is under the size thresholds', result.thresholds.exceeded === false);

const quiet = discover.discoverAll(noImpactRepo.root, {});
check('FR-07: a refactor with no public change yields no symbol changes', quiet.symbols.added.length === 0 && quiet.symbols.removed.length === 0 && quiet.symbols.changed.length === 0);
check('FR-07: a refactor with no public change yields no undocumented symbols', quiet.undocumented.length === 0);
check('FR-07: the no-impact change still lists the checked file', JSON.stringify(quiet.changedFiles) === JSON.stringify(['src/textutil.js']));

const brokenReport = links.checkLinks('docs/textutil.md', { root: brokenLinkRepo.root });
const brokenTargets = brokenReport.broken.map((entry) => entry.target).sort();
check('FR-06: the injected broken file link and anchor are both reported', JSON.stringify(brokenTargets) === JSON.stringify(['#slug-rules', 'migration-guide.md']));
check('FR-06: the baseline docs have no broken links', links.checkLinks('docs/textutil.md', { root: signatureRepo.root }).broken.length === 0 && links.checkLinks('README.md', { root: signatureRepo.root }).broken.length === 0);
check('FR-06: only docs/textutil.md changed in the broken-link scenario', JSON.stringify(discover.changedPaths(brokenLinkRepo.root, {})) === JSON.stringify(['docs/textutil.md']));

let unknownRejected = false;
try {
    buildScenarioRepo('missing');
} catch {
    unknownRejected = true;
}
check('NFR-04: an unknown scenario name is rejected', unknownRejected);

repos.forEach(removeRepo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC FIXTURE TESTS PASSED' : failures + ' DOC-SYNC FIXTURE TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
