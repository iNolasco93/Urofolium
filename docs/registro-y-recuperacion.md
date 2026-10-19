# Registro y recuperación de cuenta

UroFolium usa Supabase para autenticar las cuentas. Los datos quirúrgicos permanecen en el almacenamiento local cifrado del dispositivo.

## Configuración de Supabase

En `Authentication > Providers > Email`, activa el registro de usuarios. Para producción es recomendable activar la confirmación del correo y configurar un proveedor SMTP propio.

En `Authentication > URL Configuration`, define la URL de producción y añade como destinos permitidos:

- `http://localhost:5173/reset-password` para desarrollo.
- La URL de producción terminada en `/reset-password`.

Las plantillas de confirmación y recuperación pueden dirigir primero a la aplicación:

```html
<a href="{{ .SiteURL }}/auth/confirm?confirmation_url={{ .ConfirmationURL }}">Confirmar cuenta</a>
```

La aplicación nunca puede mostrar la contraseña actual. El flujo de recuperación envía un enlace temporal para establecer una contraseña nueva.

## Variables de entorno

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_CLIENT_ID=
```

La clave anónima de Supabase puede estar en el cliente; la seguridad de las tablas debe depender de políticas RLS. No guardes claves `service_role` ni secretos administrativos en el repositorio o en el frontend.
