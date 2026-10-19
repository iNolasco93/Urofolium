# Almacenamiento por cuenta y recuperación

Los procedimientos siguen siendo locales. Iniciar sesión no sincroniza cirugías entre dispositivos.

## Navegador

Cada cuenta tiene un almacén independiente. Los procedimientos, detalles de litiasis, metadatos, clave de respaldo y autorización de Drive se guardan en un único documento cifrado AES-256-GCM. La clave se deriva con PBKDF2-SHA-256, salt aleatorio y 600.000 iteraciones; cada escritura usa un IV nuevo. La cuenta se incluye en la autenticación del cifrado.

Al abrir los datos por primera vez se elige una **clave local** de al menos 12 caracteres. La aplicación no la persiste: la clave derivada vive en memoria hasta bloquear, salir o cerrar la página. Al recargar se pide de nuevo. El botón **Bloquear** permite cerrar el acceso sin cerrar la sesión de la cuenta.

Son tres credenciales distintas:

- Contraseña de la cuenta: autenticación con Supabase.
- Clave local: desbloquea los registros de ese navegador.
- Clave de respaldo: descifra los archivos de copia, incluidos los de Google Drive.

Perder la clave local no se resuelve restableciendo la contraseña de Supabase. Para recuperar los registros se necesita una copia cifrada y su clave de respaldo, que puede restaurarse en otro navegador o dispositivo con la misma cuenta. La app no tiene una puerta trasera para recuperar la clave local.

Las escrituras se serializan y se confirman en memoria solo después de persistir el documento cifrado completo. Una cuota agotada o error de cifrado conserva el estado anterior. Se usan Web Locks cuando están disponibles y se rechaza la escritura desde una pestaña cuyo documento ya cambió. Cerrar la sesión cancela escrituras de cifrado pendientes.

El cifrado protege los datos almacenados cuando están bloqueados; no impide que código ejecutado en el origen lea datos durante una sesión desbloqueada. No sustituye la seguridad del dispositivo, del navegador o de la aplicación.

## Datos de versiones anteriores

El almacenamiento anterior carece de propietario. No se adjudica automáticamente al primer usuario que entra. La pantalla de desbloqueo permite confirmar explícitamente que esos registros pertenecen a la cuenta actual.

La migración valida los datos, conserva los identificadores y los metadatos, copia la clave de respaldo anterior si la cuenta no tiene una propia y verifica que el documento cifrado puede abrirse antes de retirar el origen sin cifrar. Registros con un identificador ya presente en la cuenta destino se conservan en su versión de destino. Un error anterior a la copia completa mantiene el origen. La migración web requiere Web Locks para evitar que dos pestañas asignen el mismo legado a cuentas distintas.

Si se omite la migración, el origen anterior se conserva pendiente de asignar y sigue sin cifrar. Se puede volver a la pantalla con **Bloquear** para migrarlo después. Una vez asignado, otra cuenta no puede reclamarlo desde la app.

Las autorizaciones antiguas de Google no tenían propietario y se descartan. Hay que volver a conectar Drive en Ajustes; las nuevas autorizaciones quedan separadas por cuenta.

## iOS y Android

Se abre una base SQLite distinta por usuario con `encrypted: true`, modo `secret`, y SQLCipher activado en `capacitor.config.ts`. El secreto de SQLite queda en el almacén seguro del plugin. Claves de respaldo y tokens usan Secure Storage con claves por usuario.

La migración nativa copia los registros a la base cifrada en una transacción, conserva metadatos y no sustituye una clave de respaldo existente. Solo retira la base anterior después de completar la copia. Al generar los proyectos nativos, ejecutar `npx cap sync` para aplicar la configuración. Este repositorio no contiene los proyectos `ios/` y `android/`; el comportamiento de SQLCipher/Keychain/Keystore debe validarse en dispositivo antes de distribuir una app nativa.

## Restauraciones e intercambio Excel

La restauración desde Drive busca la copia cifrada de UroFolium. Antes de sustituir datos se validan formato, versiones, propietario, tipos, fechas, identificadores duplicados y relaciones entre procedimientos y detalles. La sustitución es una única escritura cifrada en web y una transacción en SQLite. Una copia inválida se rechaza antes de modificar registros.

El Excel del listado incluye los campos disponibles, los identificadores, fechas originales y detalles de litiasis. Puede reimportarse para actualizar los mismos registros. Solo incluye la selección filtrada del listado; no incluye las claves ni los metadatos del dispositivo. El archivo Excel no está cifrado y no sustituye la copia cifrada para recuperación.

Las plantillas anteriores siguen admitidas: los campos sin columna se conservan al actualizar un ID; las celdas vacías de columnas presentes vacían ese campo. Sin ID se crean registros nuevos.

## Verificación local

Usar Node.js 22.18 o posterior (validado con Node.js 26):

```sh
npm ci
npm test
npm run build
```

La suite usa datos ficticios, WebCrypto real y SQLite en memoria, con adaptadores simulados de Capacitor. Cubre aislamiento, cifrado, claves incorrectas, escrituras concurrentes, cambios de cuenta, fallos de almacenamiento, migración y rollback, validación de copias e intercambio XLSX/CSV.

La configuración PWA sigue sin ofrecer un arranque offline completo. Las pruebas locales no verifican permisos OAuth, correo de Supabase, configuración desplegada ni cifrado del sistema operativo en dispositivos físicos.
