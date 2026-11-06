# validacion-SRI

Microservicio que simula la validación de comprobantes del SRI de Ecuador para el sistema FacturaEC, escrito en Deno y TypeScript. Se despliega en Render o como Edge Function de Supabase.

Valida la clave de acceso de 49 dígitos según la ficha técnica del esquema offline del SRI (versión 2.34): estructura, fecha, tipo de comprobante, ambiente, tipo de emisión y dígito verificador módulo 11. No recibe el XML ni la firma del comprobante, no guarda estado y no contacta al SRI real.

## Contrato

`POST /functions/v1/sri-gateway`

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `claveAcceso` | string | Sí | Clave de acceso de 49 dígitos |
| `simularCaida` | boolean | No (`false`) | Simula que el SRI no responde |
| `tiempoLatenciaMs` | number | No (`400`) | Latencia simulada, de 0 a 30000 ms |

| HTTP | Caso | Cuerpo |
|---|---|---|
| 200 | Clave válida | `{estado: "AUTORIZADA", claveAcceso, numeroAutorizacion, fechaAutorizacion, ambiente, mensaje}` |
| 503 | Caída simulada | `{estado: "PENDIENTE", claveAcceso, mensaje}` |
| 422 | Clave inválida | `{estado: "RECHAZADA", error}` |
| 400 | Solicitud mal formada | `{error}` |
| 405 | Método distinto de POST | `{error}` |

## Pruebas

```bash
node --test supabase/functions/sri-gateway/gateway_test.ts
```

Requiere Node.js 24 o superior.

## Ejecución local

```bash
npx supabase init
npx supabase functions serve sri-gateway --no-verify-jwt

curl -i -X POST http://localhost:54321/functions/v1/sri-gateway \
  -H "Content-Type: application/json" \
  -d '{"claveAcceso":"0411202601990000000000110010010000000451234567816"}'
```

La clave del ejemplo usa un RUC ficticio.

## Despliegue en Render

`render.yaml` crea un servicio web gratuito con el `Dockerfile` del repositorio. En Render, elija **New → Blueprint** y seleccione este repositorio. Cada commit en `main` vuelve a desplegar el servicio.

El servicio atiende en cualquier ruta y no exige credenciales: cualquiera que conozca la URL puede invocarlo. No guarda datos.

El backend solo necesita esta variable (deje `SUPABASE_ANON_KEY` sin definir):

```bash
SRI_GATEWAY_URL=https://<nombre-del-servicio>.onrender.com
```

En el plan gratuito, el servicio se apaga tras 15 minutos sin tráfico y tarda cerca de un minuto en volver a arrancar. Por eso, el primer envío después de una pausa puede dejar la factura `PENDIENTE`; al reenviarla, se autoriza.

Para ejecutarlo en local con Deno:

```bash
PORT=8000 deno run --allow-net --allow-env=PORT servidor.ts
```

## Despliegue en Supabase

```bash
npx supabase login
npx supabase init
npx supabase link --project-ref <PROJECT_REF>
npx supabase functions deploy sri-gateway
```

Así, Supabase exige un JWT válido en `Authorization: Bearer <SUPABASE_ANON_KEY>`. Si el proyecto usa claves que no son JWT (`sb_publishable_...`), despliegue con `--no-verify-jwt`; en ese caso, cualquiera que conozca la URL puede invocar la función.

El backend necesita estas variables:

```bash
SRI_GATEWAY_URL=https://<PROJECT_REF>.supabase.co/functions/v1/sri-gateway
SUPABASE_ANON_KEY=<clave anónima del proyecto>
```
