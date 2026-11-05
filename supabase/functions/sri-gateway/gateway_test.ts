/**
 * Ejecución (Node.js 24 o superior, desde la raíz del repositorio):
 *   node --test supabase/functions/sri-gateway/gateway_test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { digitoModulo11, manejarSolicitud, motivoDeRechazo } from "./gateway.ts";

// Generada por el backend FacturaEC (RUC ficticio, provincia 99): si el algoritmo del
// backend y el de este servicio divergen, esta clave deja de ser válida.
const CLAVE_DEL_BACKEND = "0411202601990000000000110010010000000451234567816";

/** Reemplaza un tramo de la clave y recalcula el dígito verificador. */
function claveCon(posicion: number, valor: string): string {
  const base =
    CLAVE_DEL_BACKEND.slice(0, posicion) +
    valor +
    CLAVE_DEL_BACKEND.slice(posicion + valor.length, 48);
  return base + digitoModulo11(base);
}

const sinEspera = () => Promise.resolve();

function post(cuerpo: unknown): Request {
  return new Request("http://localhost/sri-gateway", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

test("módulo 11 reproduce el ejemplo de la ficha técnica del SRI", () => {
  assert.equal(digitoModulo11("41261533"), 6);
});

test("módulo 11 convierte 11 en 0 y 10 en 1", () => {
  assert.equal(digitoModulo11("14"), 0); // 4×2 + 1×3 = 11; 11 - (11 mod 11) = 11
  assert.equal(digitoModulo11("23"), 1); // 3×2 + 2×3 = 12; 11 - (12 mod 11) = 10
});

test("acepta la clave que genera el backend", () => {
  assert.equal(motivoDeRechazo(CLAVE_DEL_BACKEND), null);
});

for (const [nombre, clave, fragmento] of [
  ["sin clave", undefined, "49 dígitos"],
  ["número en lugar de texto", 1234, "49 dígitos"],
  ["48 dígitos", CLAVE_DEL_BACKEND.slice(0, 48), "49 dígitos"],
  ["50 dígitos", `${CLAVE_DEL_BACKEND}0`, "49 dígitos"],
  ["con letras", `A${CLAVE_DEL_BACKEND.slice(1)}`, "49 dígitos"],
  ["con salto de línea final", `${CLAVE_DEL_BACKEND.slice(0, 48)}\n`, "49 dígitos"],
  ["31 de febrero", claveCon(0, "31022026"), "fecha"],
  ["mes 13", claveCon(0, "01132026"), "fecha"],
  ["comprobante 02 inexistente", claveCon(8, "02"), "tipo de comprobante"],
  ["ambiente 3", claveCon(23, "3"), "ambiente"],
  ["emisión 2", claveCon(47, "2"), "emisión"],
  [
    "dígito verificador alterado",
    `${CLAVE_DEL_BACKEND.slice(0, 48)}${(Number(CLAVE_DEL_BACKEND[48]) + 1) % 10}`,
    "módulo 11",
  ],
] as const) {
  test(`rechaza: ${nombre}`, async () => {
    const respuesta = await manejarSolicitud(post({ claveAcceso: clave }), sinEspera);
    const cuerpo = await respuesta.json();
    assert.equal(respuesta.status, 422);
    assert.equal(cuerpo.estado, "RECHAZADA");
    assert.match(cuerpo.error, new RegExp(fragmento));
  });
}

test("caso A: autoriza y usa la clave como número de autorización", async () => {
  const respuesta = await manejarSolicitud(post({ claveAcceso: CLAVE_DEL_BACKEND }), sinEspera);
  const cuerpo = await respuesta.json();
  assert.equal(respuesta.status, 200);
  assert.deepEqual(Object.keys(cuerpo).sort(), [
    "ambiente",
    "claveAcceso",
    "estado",
    "fechaAutorizacion",
    "mensaje",
    "numeroAutorizacion",
  ]);
  assert.equal(cuerpo.estado, "AUTORIZADA");
  assert.equal(cuerpo.numeroAutorizacion, CLAVE_DEL_BACKEND);
  assert.equal(cuerpo.ambiente, "PRUEBAS");
  assert.equal(new Date(cuerpo.fechaAutorizacion).toISOString(), cuerpo.fechaAutorizacion);
});

test("deduce el ambiente de producción de la clave", async () => {
  const respuesta = await manejarSolicitud(post({ claveAcceso: claveCon(23, "2") }), sinEspera);
  assert.equal((await respuesta.json()).ambiente, "PRODUCCION");
});

test("caso B: la caída simulada responde 503 y PENDIENTE", async () => {
  const respuesta = await manejarSolicitud(
    post({ claveAcceso: CLAVE_DEL_BACKEND, simularCaida: true }),
    sinEspera,
  );
  const cuerpo = await respuesta.json();
  assert.equal(respuesta.status, 503);
  assert.equal(cuerpo.estado, "PENDIENTE");
  assert.equal(cuerpo.claveAcceso, CLAVE_DEL_BACKEND);
});

test("la clave inválida tiene prioridad sobre la caída simulada y no espera", async () => {
  const esperas: number[] = [];
  const respuesta = await manejarSolicitud(post({ claveAcceso: "123", simularCaida: true }), (ms) => {
    esperas.push(ms);
    return Promise.resolve();
  });
  assert.equal(respuesta.status, 422);
  assert.deepEqual(esperas, []);
});

for (const [nombre, pedida, esperadas] of [
  ["por defecto", undefined, [400]],
  ["indicada", 1500, [1500]],
  ["cero", 0, []],
] as const) {
  test(`latencia ${nombre}`, async () => {
    const esperas: number[] = [];
    await manejarSolicitud(
      post({ claveAcceso: CLAVE_DEL_BACKEND, tiempoLatenciaMs: pedida }),
      (ms) => {
        esperas.push(ms);
        return Promise.resolve();
      },
    );
    assert.deepEqual(esperas, esperadas);
  });
}

for (const [nombre, cuerpo] of [
  ["JSON mal formado", "{no es json"],
  ["cuerpo nulo", "null"],
  ["cuerpo en arreglo", "[]"],
  ["simularCaida como texto", { claveAcceso: CLAVE_DEL_BACKEND, simularCaida: "true" }],
  ["latencia negativa", { claveAcceso: CLAVE_DEL_BACKEND, tiempoLatenciaMs: -1 }],
  ["latencia excesiva", { claveAcceso: CLAVE_DEL_BACKEND, tiempoLatenciaMs: 30_001 }],
  ["latencia como texto", { claveAcceso: CLAVE_DEL_BACKEND, tiempoLatenciaMs: "400" }],
] as const) {
  test(`solicitud mal formada responde 400: ${nombre}`, async () => {
    const respuesta = await manejarSolicitud(post(cuerpo), sinEspera);
    assert.equal(respuesta.status, 400);
    assert.equal(typeof (await respuesta.json()).error, "string");
  });
}

test("OPTIONS responde con cabeceras CORS", async () => {
  const respuesta = await manejarSolicitud(
    new Request("http://localhost/sri-gateway", { method: "OPTIONS" }),
  );
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("Access-Control-Allow-Origin"), "*");
});

test("otros métodos responden 405", async () => {
  const respuesta = await manejarSolicitud(new Request("http://localhost/sri-gateway"));
  assert.equal(respuesta.status, 405);
});
