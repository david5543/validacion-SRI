// Punto de entrada para Render, que exige escuchar en 0.0.0.0 y en el puerto de la variable PORT.
import { manejarSolicitud } from "./supabase/functions/sri-gateway/gateway.ts";

const puerto = Number(Deno.env.get("PORT") ?? 8000);

Deno.serve({ hostname: "0.0.0.0", port: puerto }, (solicitud) => manejarSolicitud(solicitud));
