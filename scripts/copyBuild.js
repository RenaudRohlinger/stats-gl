import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const src = path.resolve(__dirname, '../dist/stats-gl.es.js');
const dest = path.resolve(__dirname, '../demo/stats-gl.es.js');

fs.copyFile(src, dest, (err) => {
  if (err) {
    console.error('Error occurred while copying the file.', err);
    process.exit(1);
  }
  console.log('stats-gl.es.js has been copied to the demo directory.');
});
