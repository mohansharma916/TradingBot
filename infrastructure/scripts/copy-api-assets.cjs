const fs = require('node:fs');
const path = require('node:path');
const repository = path.resolve(__dirname, '../..');
const source = path.join(repository, 'apps/api/src/market-data/proto');
const destination = path.join(repository, 'apps/api/dist/market-data/proto');
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true });
