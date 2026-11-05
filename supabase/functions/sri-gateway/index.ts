import { manejarSolicitud } from "./gateway.ts";

Deno.serve((solicitud) => manejarSolicitud(solicitud));
