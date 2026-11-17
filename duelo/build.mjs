import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'fs';
mkdirSync('www', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', target: ['chrome89'], outfile: 'www/app.js' });
for (const f of ['index.html', 'style.css']) cpSync('src/' + f, 'www/' + f);
// Fuentes dentro de la app para que se vean igual sin conexión
mkdirSync('www/fonts', { recursive: true });
cpSync('node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2', 'www/fonts/bebas.woff2');
for (const w of [400, 600, 800]) cpSync(`node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`, `www/fonts/inter-${w}.woff2`);
console.log('www listo');
