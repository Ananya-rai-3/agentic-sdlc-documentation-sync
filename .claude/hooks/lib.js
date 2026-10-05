const fs = require('fs');

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function block(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

module.exports = { readInput, block };
