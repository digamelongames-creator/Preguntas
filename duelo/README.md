# Duelo de Preguntas

Juego de cartas tipo Gwent con preguntas de la oposición. Tiene duelos online por turnos entre amigos, con cuentas de email y contraseña, y modo práctica contra la IA.

- `src/`: el código de la app (`engine.js` tiene las reglas y `preguntas.js` las cartas).
- `android/`: el proyecto Android (Capacitor).
- Cada cambio en esta carpeta hace que GitHub compile la APK y la publique en **Releases → duelo-apk**.

## Firebase (proyecto curva-olvido-f89d1)
1. **Authentication → Método de acceso → Correo electrónico/contraseña → Activar.**
2. Pon la clave web en `src/firebase-config.js`.
3. Los datos van en `/duelo` (`usuarios`, `partidas`, `misPartidas`). Cuando se cierren las reglas de la base de datos, añade:

```json
"duelo": { ".read": "auth != null", ".write": "auth != null" }
```
