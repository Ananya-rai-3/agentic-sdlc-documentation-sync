// doc-sync report grammar: render/parse round trips and fail-closed parsing (T-01).
const path = require('path');
const report = require(path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'report.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

function throws(fn) {
    try {
        fn();
        return false;
    } catch (error) {
        return error instanceof report.ReportFormatError;
    }
}

const sample = {
    status: 'COMPLETE',
    base: 'a'.repeat(40),
    syncBase: 'b'.repeat(40),
    fingerprint: 'c'.repeat(64),
    reason: '',
    checked: ['README.md section "Text utilities"', 'src/textutil.js'],
    findings: [
        { id: 'F-01', class: 'STALE', location: 'README.md#text-utilities', evidence: 'signature is `a | b` not (x)', status: 'RESOLVED' },
        { id: 'F-02', class: 'AMBIGUOUS', location: 'docs/x.md', evidence: 'path C:\\dir\\ and trailing \\', status: 'ACKNOWLEDGED' },
    ],
    changes: [{ finding: 'F-01', file: 'README.md', lines: '10-12', summary: 'fix | signature' }],
    validation: [{ finding: 'F-01', check: 'links', result: 'PASS' }],
    conclusion: 'Done.',
};

const rendered = report.renderReport(sample);
check('FR-07: rendered report uses LF only', !rendered.includes('\r'));
check('FR-07: rendered report starts with the fixed title', rendered.startsWith('# Documentation Sync Report\n'));
const parsed = report.parseReport(rendered);
check('FR-07: round trip keeps header fields', parsed.status === 'COMPLETE' && parsed.base === sample.base && parsed.syncBase === sample.syncBase && parsed.fingerprint === sample.fingerprint);
check('FR-07: round trip keeps findings', JSON.stringify(parsed.findings) === JSON.stringify(sample.findings));
check('FR-07: round trip keeps changes and validation', JSON.stringify(parsed.changes) === JSON.stringify(sample.changes) && JSON.stringify(parsed.validation) === JSON.stringify(sample.validation));
check('FR-07: pipes and backslashes in cells survive the round trip', parsed.changes[0].summary === 'fix | signature' && parsed.findings[0].evidence === 'signature is `a | b` not (x)' && parsed.findings[1].evidence === 'path C:\\dir\\ and trailing \\');
check('FR-07: checked list round trips', JSON.stringify(parsed.checked) === JSON.stringify(sample.checked));
check('NFR-01: pipe in a cell is written escaped', rendered.includes('fix \\| signature'));

const crlf = rendered.replace(/\n/g, '\r\n');
check('L-01: CRLF input parses identically to LF input', JSON.stringify(report.parseReport(crlf)) === JSON.stringify(parsed));

const failedReport = report.renderReport({ ...sample, status: 'FAILED', reason: 'git failed', findings: [], changes: [], validation: [], conclusion: 'x' });
check('FR-07: Reason is rendered and parsed for non-COMPLETE', report.parseReport(failedReport).reason === 'git failed');
check('NFR-04: non-COMPLETE without Reason is rejected', throws(() => report.renderReport({ ...sample, status: 'NEEDS_HUMAN', reason: '' })));

check('NFR-04: row with too few columns is rejected', throws(() => report.parseReport(rendered.replace('| F-01 | STALE |', '| F-01 |'))));
check('NFR-04: row with too many columns is rejected', throws(() => report.parseReport(rendered.replace('| F-01 | STALE |', '| F-01 | STALE | extra |'))));
check('NFR-04: unescaped pipe in a cell (extra column) is rejected', throws(() => report.parseReport(rendered.replace('fix \\| signature', 'fix | signature'))));
check('NFR-04: unknown finding class is rejected', throws(() => report.parseReport(rendered.replace('| STALE |', '| WRONG |'))));
check('NFR-04: unknown finding status is rejected', throws(() => report.parseReport(rendered.replace('| RESOLVED |', '| DONE |'))));
check('NFR-04: unknown Status value is rejected', throws(() => report.parseReport(rendered.replace('Status: COMPLETE', 'Status: PERFECT'))));
check('NFR-04: missing Fingerprint line is rejected', throws(() => report.parseReport(rendered.replace(/Fingerprint: .*\n/, ''))));
check('NFR-04: missing heading is rejected', throws(() => report.parseReport(rendered.replace('## Validation', '## Validate'))));
check('NFR-04: headings out of order are rejected', throws(() => report.parseReport(rendered.replace('## Changes', '## TMP').replace('## Validation', '## Changes').replace('## TMP', '## Validation'))));
check('NFR-04: wrong title is rejected', throws(() => report.parseReport(rendered.replace('# Documentation Sync Report', '# Report'))));
check('NFR-04: empty text is rejected', throws(() => report.parseReport('')));
check('NFR-04: duplicate finding ids are rejected', throws(() => report.parseReport(rendered.replace('F-02', 'F-01'))));
check('NFR-04: wrong table header is rejected', throws(() => report.parseReport(rendered.replace('| ID | Class |', '| Id | Class |'))));
check('NFR-04: non-bullet line in Checked is rejected', throws(() => report.parseReport(rendered.replace('- src/textutil.js', 'src/textutil.js'))));

const emptyTables = report.parseReport(report.renderReport({ ...sample, findings: [], changes: [], validation: [], conclusion: 'No documentation changes required.' }));
check('FR-07: empty tables are valid', emptyTables.findings.length === 0 && emptyTables.conclusion.includes('No documentation changes required'));

const templateText = require('fs').readFileSync(path.join(__dirname, '..', '.claude', 'skills', 'doc-artifact-templates', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const templateSection = templateText.split('\n## doc-sync-report.md\n')[1] || '';
const templateBlock = (/```markdown\n([\s\S]*?)\n```/.exec(templateSection) || [])[1] || '';
const templateLines = templateBlock.split('\n');
const templateHeadings = templateLines.filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
const templateTableHeaders = templateLines.filter((line) => /^\| (ID|Finding) /.test(line));
const expectedTableHeaders = [report.FINDINGS_COLUMNS, report.CHANGES_COLUMNS, report.VALIDATION_COLUMNS].map((columns) => `| ${columns.join(' | ')} |`);
check('FR-07: template title equals the parser title', templateBlock.startsWith('# Documentation Sync Report\n'));
check('FR-07: template headings equal the parser required headings in order', JSON.stringify(templateHeadings) === JSON.stringify(report.REQUIRED_HEADINGS));
check('FR-07: template table columns equal the parser columns', JSON.stringify(templateTableHeaders) === JSON.stringify(expectedTableHeaders));
check('NFR-01: template lists every header key the parser reads', ['Status:', 'Base:', 'Sync-Base:', 'Fingerprint:', 'Reason:'].every((key) => templateBlock.includes(key)));

console.log(`\n${failures === 0 ? 'ALL DOC-SYNC REPORT TESTS PASSED' : failures + ' DOC-SYNC REPORT TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
