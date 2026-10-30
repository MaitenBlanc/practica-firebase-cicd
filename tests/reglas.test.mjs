// tests/reglas.test.mjs
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, deleteDoc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env;
const CURSO = "seguridad-web";
const resena = (extra = {}) => ({ puntaje: 5, texto: "Muy bueno", autor: "Ana", creadaEn: serverTimestamp(), ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-resenas",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

test("cualquiera puede leer reseñas, incluso sin login", async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, "cursos", CURSO, "resenas", "ana")));
});

test("Ana puede crear SU reseña", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertSucceeds(setDoc(doc(db, "cursos", CURSO, "resenas", "ana"), resena()));
});

test("Ana NO puede crear una reseña a nombre de Bruno", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO, "resenas", "bruno"), resena()));
});

test("sin login no se puede escribir", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO, "resenas", "ana"), resena()));
});

test("puntaje fuera de rango o con decimales se rechaza", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ puntaje: 6 })));
  await assertFails(setDoc(ref, resena({ puntaje: 4.5 })));
});

test("no se pueden agregar campos extra (p. ej. destacada: true)", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO, "resenas", "ana"), resena({ destacada: true })));
});

test("la fecha de creación la pone el servidor y no se puede cambiar", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ creadaEn: Timestamp.fromDate(new Date(2020, 0, 1)) })));
  await assertSucceeds(setDoc(ref, resena()));
  await assertFails(updateDoc(ref, { creadaEn: Timestamp.now() }));
  await assertSucceeds(updateDoc(ref, { puntaje: 4 }));
});

test("el cliente no puede escribir el documento del curso", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO), { resumen: { cantidad: 999, promedio: 5 } }));
});

test("Bruno NO puede editar ni borrar la reseña de Ana, pero Ana sí puede borrar la suya", async () => {
  const dbAna = env.authenticatedContext("ana").firestore();
  const dbBruno = env.authenticatedContext("bruno").firestore();
  const refAnaInAna = doc(dbAna, "cursos", CURSO, "resenas", "ana");
  const refAnaInBruno = doc(dbBruno, "cursos", CURSO, "resenas", "ana");

  await assertSucceeds(setDoc(refAnaInAna, resena()));
  await assertFails(updateDoc(refAnaInBruno, { texto: "Modificada por Bruno" }));
  await assertFails(deleteDoc(refAnaInBruno));
  await assertSucceeds(deleteDoc(refAnaInAna));
});

test("texto o autor vacíos o que superan el límite de caracteres se rechazan", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ texto: "" })));
  await assertFails(setDoc(ref, resena({ autor: "" })));
  await assertFails(setDoc(ref, resena({ texto: "a".repeat(501) })));
  await assertFails(setDoc(ref, resena({ autor: "a".repeat(81) })));
});