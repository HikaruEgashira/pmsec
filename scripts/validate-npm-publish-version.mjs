const input = process.argv[2] ?? '';
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(input);

if (!match) {
  console.error(`cannot parse npm version for trusted publishing: ${input || '(empty)'}`);
  process.exit(1);
}

const [major, minor, patch] = match.slice(1).map(Number);
if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
  console.error(`npm ${input} is too old for trusted publishing; require >=11.5.1`);
  process.exit(1);
}
