// Shared test helpers: throwaway git repositories and file writers for the doc-sync tests.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function createRepo(prefix = 'docsync-') {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q', '-b', 'master');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    return { root, git };
}

function writeFile(root, relativePath, content) {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function commitAll(repo, message) {
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', message);
    return repo.git('rev-parse', 'HEAD').trim();
}

function removeRepo(repo) {
    try {
        fs.rmSync(repo.root, { recursive: true, force: true });
    } catch (error) {
        console.log(`(cleanup skipped for ${repo.root}: ${error.code})`);
    }
}

module.exports = { createRepo, writeFile, commitAll, removeRepo };
