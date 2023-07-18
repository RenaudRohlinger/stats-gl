import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';


// copy dir dist to demo/dist
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDist = path.resolve(__dirname, '../demo/dist');
const dist = path.resolve(__dirname, '../dist');
const copyDir = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((file) => {
        const srcFile = path.join(src, file);
        const destFile = path.join(dest, file);
        fs.copyFileSync(srcFile, destFile);
    });
    }
copyDir(dist, demoDist);
