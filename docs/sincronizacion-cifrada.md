# Sincronización cifrada entre dispositivos

El diario se vincula a la cuenta de Supabase. En el primer dispositivo, después de desbloquear los registros, se genera una clave aleatoria de sincronización. En Ajustes se puede mostrar y guardar en un gestor de contraseñas. En otro dispositivo se inicia sesión con la misma cuenta, se abre su almacenamiento local y se introduce esa clave una vez. La clave local, la contraseña de la cuenta y la clave de respaldo son independientes.

Los registros existentes permanecen en el dispositivo. La primera sincronización añade los identificadores que falten; nunca interpreta una ausencia como un borrado. Si un mismo identificador contiene cambios incompatibles, la aplicación muestra ambas versiones y permite conservar una. No se deduplican automáticamente registros con distintos identificadores.

Cada entrada contiene el estado, las notas, la cirugía y todos sus detalles de litiasis, incluido `stonefree`. Las programadas se excluyen de las estadísticas hasta completarlas. Se selecciona el caso completo en un conflicto. Un borrado usa `deleted_at`, conserva la entrada y se propaga a los dispositivos vinculados. Las marcas de borrado no se purgan. Restaurar una copia antigua puede recuperar casos borrados: se trata como una edición y puede requerir resolver diferencias. Los casos remotos ausentes de esa copia vuelven a incorporarse.

La aplicación sincroniza al abrir los datos, al guardar, al recuperar conexión, al volver a primer plano y cada minuto mientras está visible. Se pueden guardar cambios sin conexión después de acceder a la aplicación y desbloquear los datos. No se garantiza el arranque sin conexión de una instalación web ni la ejecución con la app cerrada. Ante errores de red, clave o almacenamiento, conserva los datos locales y muestra el estado pendiente.

## Formato y concurrencia

- Instantánea JSON cifrada con AES-256-GCM; clave derivada con PBKDF2-SHA256 y 600 000 iteraciones, sal e IV aleatorios por cifrado.
- La autenticación adicional del cifrado incluye formato, versión, cuenta, canal y revisión: una copia trasladada a otro contexto no se puede abrir.
- Supabase guarda un sobre cifrado por cuenta/canal, con un máximo de 8 MiB por sobre. No recibe la clave ni el contenido en claro. Metadatos visibles: cuenta, tamaño, revisión y fecha de actualización.
- La combinación usa hashes de contenido y una base de la última sincronización. Los relojes no deciden qué cambio gana. Una escritura remota exige la revisión esperada y usa un bloqueo transaccional por cuenta.
- Datos y base de sincronización se guardan juntos en el almacenamiento local cifrado. Las escrituras locales están serializadas y una respuesta obsoleta no sustituye cambios posteriores.
- Los formularios abiertos y las exportaciones comprueban que el caso no haya cambiado durante la revisión. Los backups leen cirugía y litiasis de una misma instantánea local.

La sincronización no sustituye un backup: propaga también errores y borrados. Las copias manuales y de Drive siguen usando su propio cifrado y clave. La copia automática espera a que el diario esté sincronizado; si falta vincular el dispositivo o hay conflictos, se omite esa ejecución. Las copias manuales siguen disponibles. Si se pierden la clave de sincronización y todos los dispositivos vinculados, el servidor no puede descifrar el diario. Un backup con su clave permite recuperar los registros localmente; no restablece la clave remota perdida. Esta versión no incluye rotación ni restablecimiento de la clave remota.

## Despliegue y comprobación

La migración `supabase/migrations/20261030000000_encrypted_shared_diary.sql` debe aplicarse antes de publicar el cliente. RLS permite leer únicamente la fila propia; las escrituras directas están revocadas y pasan por la función con revisión esperada. No modifica las tablas clínicas existentes.

`npm test` cubre cifrado, vinculación, colisiones, conflictos, borrados, recuperación tras fallos, cancelación de sesiones y almacenamiento web/SQLite transaccional. La suite SQLite usa un adaptador de prueba; no sustituye una comprobación en dispositivos iOS y Android reales.

Las versiones anteriores deben actualizarse para leer los casos con estado y notas. Sus datos locales se conservan si aún no pueden leer la copia nueva.
