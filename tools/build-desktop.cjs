const { spawnSync } = require('node:child_process');
const path = require('node:path');

const mode = process.argv.includes('--pack') ? 'pack' : 'dir';
const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  '_',
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('');

const outputDir = path.join('desktop-release', `${mode}-${stamp}`);
const builderBin = path.join('node_modules', '.bin', 'electron-builder.cmd');
const builderArgs =
  mode === 'pack'
    ? ['--win', 'nsis', '--x64', '--publish', 'never']
    : ['--dir', '--publish', 'never'];

const result = spawnSync(
  builderBin,
  [...builderArgs, `--config.directories.output=${outputDir}`],
  {
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    shell: true,
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`\nDesktop ${mode} output: ${outputDir}`);
