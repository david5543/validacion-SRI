# validacion-SRI

Microservicio que simula la validación de comprobantes del SRI de Ecuador para el sistema FacturaEC. Es una Edge Function de Supabase (Deno y TypeScript).

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

## Despliegue

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
