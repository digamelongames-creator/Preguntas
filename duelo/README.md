# Duelo de Preguntas

Juego de cartas tipo Gwent con preguntas de la oposición. Tiene duelos online por turnos entre amigos, con cuentas de email y contraseña, y modo práctica contra la IA.

- `src/`: el código de la app (`engine.js` tiene las reglas y `preguntas.js` las cartas).
- `android/`: el proyecto Android (Capacitor).
- Cada cambio en esta carpeta hace que GitHub compile la APK (**Releases → duelo-apk**) y el paquete de actualización (**Releases → duelo-web**).
- La app busca actualizaciones al abrirse y al volver a primer plano, y se actualiza sola. Si cambias algo de Android (plugins, icono, permisos), sube `NATIVO` en `src/app.js`: las apps antiguas avisarán de descargar la APK nueva.
- Al crear cuenta se envía un correo de confirmación; sin confirmar no se entra en la sala.

## Firebase (proyecto curva-olvido-f89d1)
1. **Authentication → Método de acceso → Correo electrónico/contraseña → Activar.**
2. Pon la clave web en `src/firebase-config.js`.
3. Los datos van en `/duelo` (`usuarios`, `partidas`, `misPartidas`). Cuando se cierren las reglas de la base de datos, añade:

```json
"duelo": { ".read": "auth != null", ".write": "auth != null" }
```
