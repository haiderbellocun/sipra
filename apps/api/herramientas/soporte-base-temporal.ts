import { DataSource } from 'typeorm';

/**
 * Borra una base temporal de verificación sin dejarla huérfana. `WITH (FORCE)` termina las conexiones abiertas, pero un
 * rol sin superusuario no puede terminar procesos ajenos (p. ej. un autovacuum lanzado tras una carga masiva): en ese
 * caso se espera a que terminen y se reintenta sin FORCE. Si al final la base sigue existiendo, falla en voz alta.
 */
export async function borrarBaseTemporal(admin: DataSource, nombre: string, intentos = 20): Promise<void> {
  for (let i = 0; i < intentos; i += 1) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${nombre}"${i === 0 ? ' WITH (FORCE)' : ''}`);
      return;
    } catch (e) {
      if (!/terminar el proceso|terminate|being accessed by other users|siendo utilizada por otros usuarios/i.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const quedan = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre])) as unknown[];
  if (quedan.length) throw new Error(`No se pudo borrar la base temporal ${nombre}: bórrela a mano`);
}
