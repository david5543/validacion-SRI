/**
 * Simulador del SRI: valida la clave de acceso y responde como autorizada o en contingencia.
 * No firma ni recibe el XML del comprobante, ni contacta al SRI real.
 *
 * Las reglas provienen de la ficha técnica del esquema offline del SRI (versión 2.34):
 * tabla 1 (estructura), tabla 2 (emisión), tabla 3 (comprobantes) y tabla 4 (ambiente).
 * Solo usa API web estándar, para poder probarse sin el entorno de Supabase.
 */

const CABECERAS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIPOS_COMPROBANTE = new Set(["01", "03", "04", "05", "06", "07"]);
const LATENCIA_POR_DEFECTO_MS = 400;
// Suficiente para superar los 15 s de espera por intento del backend FacturaEC sin
// retener la función hasta su límite de duración en Supabase.
const LATENCIA_MAXIMA_MS = 30_000;

type Esperar = (milisegundos: number) => Promise<unknown>;

const esperarReal: Esperar = (milisegundos) =>
  new Promise((resolver) => setTimeout(resolver, milisegundos));

function responder(estadoHttp: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estadoHttp,
    headers: { ...CABECERAS, "Content-Type": "application/json" },
  });
}

/** Pesos 2 a 7 de derecha a izquierda; 11 se convierte en 0 y 10 en 1. */
export function digitoModulo11(digitos: string): number {
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    suma += Number(digitos[digitos.length - 1 - i]) * (2 + (i % 6));
  }
  const resultado = 11 - (suma % 11);
  if (resultado === 11) return 0;
  if (resultado === 10) return 1;
  return resultado;
}

function esFechaValida(ddmmaaaa: string): boolean {
  const dia = Number(ddmmaaaa.slice(0, 2));
  const mes = Number(ddmmaaaa.slice(2, 4));
  const anio = Number(ddmmaaaa.slice(4, 8));
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  );
}

/** Devuelve el motivo del rechazo, o null si la clave es válida. */
export function motivoDeRechazo(clave: unknown): string | null {
  if (typeof clave !== "string" || !/^[0-9]{49}$/.test(clave)) {
    return "Clave de acceso inválida. Debe contener exactamente 49 dígitos numéricos.";
  }
  if (!esFechaValida(clave.slice(0, 8))) {
    return "Clave de acceso inválida. La fecha de emisión no es una fecha válida (ddmmaaaa).";
  }
  if (!TIPOS_COMPROBANTE.has(clave.slice(8, 10))) {
    return "Clave de acceso inválida. El tipo de comprobante no existe en el catálogo del SRI.";
  }
  if (clave[23] !== "1" && clave[23] !== "2") {
    return "Clave de acceso inválida. El tipo de ambiente debe ser 1 (pruebas) o 2 (producción).";
  }
  if (clave[47] !== "1") {
    return "Clave de acceso inválida. El tipo de emisión debe ser 1 (normal).";
  }
  if (digitoModulo11(clave.slice(0, 48)) !== Number(clave[48])) {
    return "Clave de acceso inválida. El dígito verificador (módulo 11) no coincide.";
  }
  return null;
}

async function procesar(solicitud: Request, esperar: Esperar): Promise<Response> {
  let cuerpo: unknown;
  try {
    cuerpo = await solicitud.json();
  } catch {
    return responder(400, { error: "El cuerpo de la solicitud debe ser JSON válido." });
  }
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return responder(400, { error: "El cuerpo de la solicitud debe ser un objeto JSON." });
  }

  const {
    claveAcceso,
    simularCaida = false,
    tiempoLatenciaMs = LATENCIA_POR_DEFECTO_MS,
  } = cuerpo as Record<string, unknown>;

  if (typeof simularCaida !== "boolean") {
    return responder(400, { error: "simularCaida debe ser booleano." });
  }
  if (
    typeof tiempoLatenciaMs !== "number" ||
    tiempoLatenciaMs < 0 ||
    tiempoLatenciaMs > LATENCIA_MAXIMA_MS
  ) {
    return responder(400, {
      error: `tiempoLatenciaMs debe ser un número entre 0 y ${LATENCIA_MAXIMA_MS}.`,
    });
  }

  const motivo = motivoDeRechazo(claveAcceso);
  if (motivo !== null) {
    return responder(422, { error: motivo, estado: "RECHAZADA" });
  }
  const clave = claveAcceso as string;

  if (tiempoLatenciaMs > 0) {
    await esperar(tiempoLatenciaMs);
  }

  if (simularCaida) {
    return responder(503, {
      estado: "PENDIENTE",
      claveAcceso: clave,
      mensaje: "El servidor del SRI no respondió tras el tiempo límite. Factura en contingencia.",
    });
  }

  return responder(200, {
    estado: "AUTORIZADA",
    claveAcceso: clave,
    // En el esquema offline, la clave de acceso es también el número de autorización (ficha, 5.9).
    numeroAutorizacion: clave,
    fechaAutorizacion: new Date().toISOString(),
    ambiente: clave[23] === "1" ? "PRUEBAS" : "PRODUCCION",
    mensaje: "Comprobante autorizado por el SRI",
  });
}

export async function manejarSolicitud(
  solicitud: Request,
  esperar: Esperar = esperarReal,
): Promise<Response> {
  if (solicitud.method === "OPTIONS") {
    return new Response("ok", { headers: CABECERAS });
  }
  if (solicitud.method !== "POST") {
    return responder(405, { error: "Método no permitido. Use POST." });
  }
  try {
    return await procesar(solicitud, esperar);
  } catch (error) {
    console.error("Error inesperado en sri-gateway:", error);
    return responder(500, { error: "Error interno procesando la solicitud en el gateway SRI" });
  }
}
