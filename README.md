# UroFolium

Logbook quirúrgico urológico para registrar actividad formativa, consultar estadísticas y conservar copias cifradas de los datos.

## Desarrollo local

Requiere Node.js 22.18 o posterior.

```sh
npm install
cp .env.example .env.local
npm run dev
npm test
npm run build
```

Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para la autenticación. `VITE_GOOGLE_CLIENT_ID` es opcional y habilita las copias cifradas en Google Drive.

## Privacidad

Los registros clínicos se almacenan localmente y cifrados por cuenta. No introduzcas nombres, NHC, fechas de nacimiento, teléfonos ni otros datos que identifiquen a pacientes. Los archivos Excel exportados no están cifrados.

- [Registro y recuperación de cuenta](docs/registro-y-recuperacion.md)
- [Almacenamiento cifrado, migración y copias](docs/almacenamiento-seguro.md)

## Derechos

Copyright © 2026 Ivan Nolasco. Todos los derechos reservados. Este repositorio no concede una licencia para copiar, modificar, distribuir ni explotar comercialmente el código.
