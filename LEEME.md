# Reglas de Firestore corregidas (fase 0)

Contenido:
- `firestore.rules`: reglas propuestas. Son compatibles con las pantallas actuales, así que se pueden publicar sin tocar el código.
- `reglas.test.mjs`: 18 pruebas automáticas (seguridad, flujos actuales, integridad).
- `.github/workflows/reglas.yml`: corre las pruebas en GitHub en cada cambio.

## Cómo probarlas en tu computador (requiere Node 22 y Java 21)
    npm install
    npm run test:reglas
Todas deben salir en verde (✓) antes de publicar.

## Cómo publicarlas (solo después de que pasen las pruebas)
Consola de Firebase → Firestore → Reglas. Pega el contenido de `firestore.rules`, usa el botón de simulación para probar un caso y publica.
Para volver atrás: la consola guarda el historial de versiones de las reglas.
