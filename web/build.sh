#!/bin/sh
# Prepara la web de www.oposinator.com (Cloudflare) con solo los archivos públicos de Mazos.
set -e
rm -rf public && mkdir -p public
cp index.html manifest.json sw.js icon-192.png icon-512.png icon-maskable-512.png traslado.html privacidad.html public/
cp web/_headers public/
# Duelo de Preguntas: actualización automática y APK (las deja ahí el workflow duelo-apk)
if [ -d web/duelo ]; then mkdir -p public/duelo && cp web/duelo/bundle.zip web/duelo/version.json public/duelo/ 2>/dev/null || true; cp web/duelo/DueloDePreguntas.apk public/duelo/ 2>/dev/null || true; fi
echo "public listo"
