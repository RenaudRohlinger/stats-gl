import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const src = path.resolve(__dirname, '../dist/main.js');
const dest = path.resolve(__dirname, '../demo/main.js');

fs.copyFile(src, dest, (err) => {
  if (err) {
    console.error('Error occurred while copying the file.', err);
    process.exit(1);
  }
  console.log('main.es.js has been copied to the demo directory.');
});

const src2 = path.resolve(__dirname, '../dist/panel.js');
const dest2 = path.resolve(__dirname, '../demo/panel.js');

fs.copyFile(src2, dest2, (err) => {
  if (err) {
    console.error('Error occurred while copying the file.', err);
    process.exit(1);
  }
  console.log('panel.es.js has been copied to the demo directory.');
});
