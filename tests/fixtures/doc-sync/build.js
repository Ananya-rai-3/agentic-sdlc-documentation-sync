// Builds throwaway git repositories for the doc-sync tests from static fixture files (T-14).
const fs = require('fs');
const path = require('path');
const { createRepo, writeFile, commitAll } = require('../../helpers');

const FIXTURE_ROOT = __dirname;
const SCENARIOS = ['signature-change', 'no-doc-impact', 'broken-link'];

function listFiles(directory, prefix = '') {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
    });
}

function copyTree(sourceDirectory, targetRoot) {
    for (const relativePath of listFiles(sourceDirectory)) {
        writeFile(targetRoot, relativePath, fs.readFileSync(path.join(sourceDirectory, ...relativePath.split('/'))));
    }
}

// Returns a repo (see tests/helpers.js) with the baseline on master and the scenario committed on branch "feature".
function buildScenarioRepo(scenario) {
    if (!SCENARIOS.includes(scenario)) throw new Error(`unknown doc-sync fixture scenario: ${scenario}`);
    const repo = createRepo(`docsync-fixture-${scenario}-`);
    copyTree(path.join(FIXTURE_ROOT, 'base'), repo.root);
    commitAll(repo, 'baseline: code and docs agree');
    repo.git('switch', '-q', '-c', 'feature');
    copyTree(path.join(FIXTURE_ROOT, 'scenarios', scenario), repo.root);
    commitAll(repo, `scenario: ${scenario}`);
    return repo;
}

module.exports = { buildScenarioRepo, SCENARIOS };
