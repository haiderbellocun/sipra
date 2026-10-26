import { AlcanceVisibilidad, Permiso, Rol, alcancePorRol } from '../value-objects/rol.vo';

export interface DatosUsuario {
  id: string;
  correo: string;
  nombre: string;
  documento: string | null;
  rol: Rol;
  /** consulta | escritura (SGP). Estudiantes y empresas siempre escriben. */
  permiso: Permiso;
  escuelas: string[];
  empresaId: string | null;
  programaId: string | null;
  activo: boolean;
  creadoEn: Date;
  ultimoAccesoEn: Date | null;
}

export class Usuario {
  private constructor(private datos: DatosUsuario) {}

  static desde(datos: DatosUsuario): Usuario {
    return new Usuario({ ...datos, escuelas: [...datos.escuelas] });
  }

  get id(): string { return this.datos.id; }
  get correo(): string { return this.datos.correo; }
  get nombre(): string { return this.datos.nombre; }
  get rol(): Rol { return this.datos.rol; }
  get permiso(): Permiso { return this.datos.permiso; }
  get soloConsulta(): boolean { return this.datos.permiso === 'consulta'; }
  get activo(): boolean { return this.datos.activo; }
  get empresaId(): string | null { return this.datos.empresaId; }
  get escuelas(): readonly string[] { return this.datos.escuelas; }

  instantanea(): DatosUsuario {
    return { ...this.datos, escuelas: [...this.datos.escuelas] };
  }

  get alcance(): AlcanceVisibilidad {
    return alcancePorRol(this.datos.rol, {
      escuelas: this.datos.escuelas,
      empresaId: this.datos.empresaId,
    });
  }

  /** Gestión de usuarios administrativos (SGP): editar, activar o inhabilitar. */
  actualizar(cambios: Partial<Pick<DatosUsuario, 'nombre' | 'documento' | 'escuelas' | 'permiso' | 'activo' | 'programaId'>>): void {
    if (cambios.nombre !== undefined) this.datos.nombre = cambios.nombre;
    if (cambios.documento !== undefined) this.datos.documento = cambios.documento;
    if (cambios.escuelas !== undefined) this.datos.escuelas = [...cambios.escuelas];
    if (cambios.permiso !== undefined) this.datos.permiso = cambios.permiso;
    if (cambios.activo !== undefined) this.datos.activo = cambios.activo;
    if (cambios.programaId !== undefined) this.datos.programaId = cambios.programaId;
  }

  registrarAcceso(ahora: Date = new Date()): void {
    this.datos.ultimoAccesoEn = ahora;
  }
}
