/**
 * Configuración web de tu proyecto Firebase.
 * Consola de Firebase → ⚙ Configuración del proyecto → General → Tus apps → App web → SDK setup and configuration
 *
 * Estos valores NO son secretos: viajan en el bundle de JavaScript y cualquiera puede verlos.
 * La seguridad no depende de esconderlos, sino de Auth + las reglas @auth de SQL Connect
 * (y, más adelante, App Check).
 *
 * Mientras desarrollás con `npm run dev`, la app usa los emuladores locales y no importa
 * si estos valores son reales. Para producción tenés que completarlos.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyC5H-lAWtjZnD4wo_GJF2ZAPIRnUqV9Er0",
  authDomain: "practica-firebase-cicd-33d61.firebaseapp.com",
  projectId: "practica-firebase-cicd-33d61",
  appId: "1:1042385467489:web:4a5e98c07d534dc5f1d220"
};

/** Debe coincidir con dataconnect/dataconnect.yaml y dataconnect/cursos/connector.yaml */
export const sqlConnectConfig = {
  location: "us-east4",
  service: "catalogo",
  connector: "cursos",
};
