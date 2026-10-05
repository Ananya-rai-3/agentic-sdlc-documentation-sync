// Demo module tests: src/textutil.js (T-12).
const path = require('path');
const { slugify, truncate, wordCount } = require(path.join(__dirname, '..', 'src', 'textutil.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}
function throwsType(fn, errorType) {
    try {
        fn();
        return false;
    } catch (error) {
        return error instanceof errorType;
    }
}

check('FR-12: slugify lowercases and joins words with hyphens', slugify('Hello World') === 'hello-world');
check('FR-12: slugify collapses punctuation and repeated separators', slugify('  Hello,   World!! ') === 'hello-world');
check('FR-12: slugify trims leading and trailing hyphens', slugify('--A b--') === 'a-b');
check('FR-12: slugify of only punctuation is empty', slugify('!!!') === '');
check('FR-12: slugify rejects non-string input', throwsType(() => slugify(42), TypeError));

check('FR-12: truncate cuts text longer than max', truncate('abcdef', 3) === 'abc');
check('FR-12: truncate keeps text at or below max', truncate('abc', 3) === 'abc' && truncate('ab', 3) === 'ab');
check('FR-12: truncate with max 0 returns an empty string', truncate('abc', 0) === '');
check('FR-12: truncate rejects a negative or non-integer max', throwsType(() => truncate('abc', -1), RangeError) && throwsType(() => truncate('abc', 1.5), RangeError));
check('FR-12: truncate rejects non-string text', throwsType(() => truncate(null, 3), TypeError));

check('FR-12: truncate appends the ellipsis option after a cut', truncate('abcdef', 3, { ellipsis: '...' }) === 'abc...');
check('FR-12: truncate leaves short text without an ellipsis', truncate('abc', 3, { ellipsis: '...' }) === 'abc');
check('FR-12: truncate without options is unchanged', truncate('abcdef', 3, {}) === 'abc');

check('FR-12: wordCount counts whitespace-separated words', wordCount('one two  three\nfour') === 4);
check('FR-12: wordCount of empty or blank text is 0', wordCount('') === 0 && wordCount('   ') === 0);
check('FR-12: wordCount rejects non-string input', throwsType(() => wordCount(5), TypeError));

console.log(`\n${failures === 0 ? 'ALL TEXTUTIL TESTS PASSED' : failures + ' TEXTUTIL TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
