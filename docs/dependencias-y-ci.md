# Dependencias y CI

GitHub ejecuta instalación limpia (`npm ci`), pruebas, compilación y `npm audit --audit-level=moderate` con Node 22.18.0. Un despliegue correcto en Vercel no sustituye esta comprobación. El umbral de la auditoría sigue siendo moderado.

## Actualización del 31 de octubre de 2026

Los commits de sincronización y retirada de la migración pasaron las pruebas y la compilación, pero fallaron la auditoría por dependencias transitivas de las herramientas de construcción.

- `fast-uri` se actualiza a 3.1.9 y `serialize-javascript` a 7.1.4 en el lockfile.
- El override `glob: 14.0.3` sustituye las versiones vulnerables usadas por Rimraf/Capacitor y Workbox. Incluye `minimatch` 11.0.3. Los avisos son [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) y [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
- El override `@trickfilm400/rollup-plugin-off-main-thread: 4.0.0` usa EJS 7 y elimina la cadena antigua EJS/Jake/Filelist con Minimatch vulnerable. La [versión del mantenedor](https://github.com/Trickfilm400/rollup-plugin-off-main-thread/releases/tag/v4.0.0) actualiza esas dependencias.

Los overrides son temporales hasta que los paquetes que los incorporan admitan versiones corregidas. Las pruebas de `buildTooling.test.mjs` ejercitan la generación real de un worker de producción con Workbox y el borrado con patrones de Rimraf, dentro de directorios temporales. Así se comprueba la compatibilidad de las nuevas dependencias, además de compilar la aplicación.

Queda el aviso leve [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) de `deepmerge`, sin versión corregida publicada a esta fecha. Npm lo contabiliza en cuatro paquetes de la misma cadena: `deepmerge`, `@rollup/plugin-node-resolve`, `workbox-build` y `vite-plugin-pwa`. No se ha excluido de la auditoría ni se ha cambiado su severidad. Es parte de las herramientas de construcción; no se utiliza en el código de la aplicación. No se aplica la bajada de versiones incompatible sugerida por `npm audit fix --force`.
