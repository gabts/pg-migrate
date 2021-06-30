#!/usr/bin/env node

const fs = require('fs');

const opts = {
  directory: 'migrations',
  name: undefined,
};

let i = 2;
while (i < process.argv.length) {
  switch (process.argv[i]) {
    case '-d':
    case '--directory':
      opts.directory = process.argv[i + 1];
      i += 2;
      break;
    case '-n':
    case '--name':
      opts.name = process.argv[i + 1].replace(/.sql$/, '');
      i += 2;
      break;
    default:
      i++;
  }
}

if (!opts.name) throw new Error('Name flag (--name, -n) is required');

let index = 0;
const files = fs.readdirSync(opts.directory);
for (const file of files) {
  const fileIndex = parseInt(file.split('-')[0], 10);
  if (!Number.isNaN(fileIndex) && fileIndex >= index) index = fileIndex + 1;
}

const filePath = `${opts.directory}/${index}-${opts.name}.sql`;
const fileContent = '-- % up migration % --\n\n-- % down migration % --\n';
fs.writeFileSync(filePath, fileContent);
