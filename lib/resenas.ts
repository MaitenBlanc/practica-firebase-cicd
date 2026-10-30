import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
    average,
    collection,
    connectFirestoreEmulator,
    count,
    deleteDoc,
    doc,
    getAggregateFromServer,
    getFirestore,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    where,
    type Firestore,
    type Timestamp,
    type Unsubscribe,
} from "firebase/firestore";

export interface Resena {
    uid: string; // = id del documento
    puntaje: number; // 1..5
    texto: string;
    autor: string;
    creadaEn: Timestamp | null; // null mientras el serverTimestamp está pendiente (escritura local)
}
let db: Firestore | null = null;
export function firestore(): Firestore {
    if (db) return db;
    db = getFirestore(getApp());
    if (process.env.NODE_ENV === "development") connectFirestoreEmulator(db, "127.0.0.1", 8080);
    return db;
}
const resenasDe = (cursoId: string) => collection(firestore(), "cursos", cursoId, "resenas");

/** Paso 3 · Crear o editar MI reseña. El id del documento es mi UID: una reseña por persona y curso. */
export async function guardarResena(
  cursoId: string,
  puntaje: number,
  texto: string,
  esNueva: boolean,
): Promise<void> {
  const usuario = getAuth().currentUser;
  if (!usuario) throw new Error("Tenés que ingresar para dejar una reseña.");
  const ref = doc(resenasDe(cursoId), usuario.uid);
  const datos = { puntaje, texto, autor: usuario.displayName ?? "Anónimo" };
  if (esNueva) await setDoc(ref, { ...datos, creadaEn: serverTimestamp() });
  else await setDoc(ref, datos, { merge: true }); // conserva creadaEn
}
export async function borrarResena(cursoId: string): Promise<void> {
  const usuario = getAuth().currentUser;
  if (!usuario) return;
  await deleteDoc(doc(resenasDe(cursoId), usuario.uid));
}

/** Paso 4 · Últimas reseñas en tiempo real. Devuelve la función para cancelar la suscripción. */
export function escucharResenas(
  cursoId: string,
  alCambiar: (resenas: Resena[]) => void,
  alFallar: (e: Error) => void,
  soloCincoEstrellas = false,
): Unsubscribe {
  const filtros = soloCincoEstrellas ? [where("puntaje", "==", 5)] : [];
  const q = query(
    resenasDe(cursoId),
    ...filtros,
    orderBy("creadaEn", "desc"),
    limit(20),
  );
  return onSnapshot(
    q,
    (snap) =>
      alCambiar(
        snap.docs.map((d) => {
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            uid: d.id,
            puntaje: data.puntaje,
            texto: data.texto,
            autor: data.autor,
            creadaEn: data.creadaEn ?? null,
          };
        }),
      ),
    alFallar,
  );
}

/** Paso 5 · Promedio y cantidad calculados por el servidor (consulta de agregación). */
export async function resumenDe(
  cursoId: string,
): Promise<{ cantidad: number; promedio: number | null }> {
  const snap = await getAggregateFromServer(resenasDe(cursoId), {
    cantidad: count(),
    promedio: average("puntaje"),
  });
  return snap.data();
}
