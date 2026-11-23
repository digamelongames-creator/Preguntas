#!/bin/sh
# Prepara la web de www.oposinator.com (Cloudflare) con solo los archivos públicos de Mazos.
set -e
rm -rf public && mkdir -p public
cp index.html manifest.json sw.js icon-192.png icon-512.png icon-maskable-512.png traslado.html privacidad.html public/
cp web/_headers public/
echo "public listo"
