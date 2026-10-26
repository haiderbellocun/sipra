import { Usuario } from '../../../domain/entities/usuario.entity';
import { Rol } from '../../../domain/value-objects/rol.vo';

/**
 * Elige el usuario de prueba que representa a un perfil en el ambiente abierto:
 * activo, con permiso de escritura antes que de consulta y, para coordinación,
 * la del Área de Prácticas (sin escuelas) antes que la de una escuela. Así el
 * selector muestra el perfil que puede operar el proceso completo.
 */
export function perfilPredeterminado(candidatos: readonly Usuario[]): Usuario | null {
  const peso = (u: Usuario): number =>
    (u.activo ? 0 : 100)
    + (u.permiso === 'escritura' ? 0 : 10)
    + (u.rol === Rol.COORDINADOR && u.escuelas.length > 0 ? 1 : 0);
  return [...candidatos].sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, 'es'))[0] ?? null;
}
