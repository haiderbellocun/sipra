import { Inject, Injectable } from '@nestjs/common';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { PerfilDisponibleDto, UsuarioDePerfilDto } from '../../dtos/auth.dto';
import { Usuario } from '../../../domain/entities/usuario.entity';
import {
  USUARIO_REPOSITORY,
  UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { perfilPredeterminado } from './perfil-predeterminado';

const DESCRIPCIONES: Record<Rol, string> = {
  [Rol.ESTUDIANTE]: 'Carga documentos, consulta el estado de su práctica y accede a la bolsa cuando se habilita',
  [Rol.TUTOR]: 'Bandeja de estudiantes priorizada por señal de riesgo; aprueba el plan de mejoramiento',
  [Rol.COORDINADOR]: 'Supervisa los expedientes de su escuela y genera reportes',
  [Rol.ADMINISTRADOR]: 'Habilita empresas, parametriza, audita y genera reportes regulatorios',
  [Rol.EMPRESA]: 'Consulta sus practicantes, publica vacantes y revisa postulantes',
  [Rol.EXTENSION]: 'Opera la bolsa de empleo y sus reportes al Servicio Público de Empleo',
  [Rol.AUXILIAR]: 'Auxiliar de prácticas: valida las solicitudes de ARL de las modalidades articuladas y revisa documentos',
};

/** Alimenta el selector de perfil del ambiente de pruebas. */
@Injectable()
export class ListarPerfilesDisponiblesUseCase {
  constructor(
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
  ) {}

  async ejecutar(): Promise<PerfilDisponibleDto[]> {
    const perfiles: PerfilDisponibleDto[] = [];
    for (const rol of Object.values(Rol)) {
      const activos = (await this.usuarios.listarPorRol(rol)).filter((u) => u.activo);
      const usuario = perfilPredeterminado(activos);
      if (!usuario) continue;
      const resto = activos.filter((u) => u.id !== usuario.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      perfiles.push({
        rol,
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        descripcion: DESCRIPCIONES[rol],
        usuarios: [usuario, ...resto].map((u) => this.presentar(u)),
      });
    }
    return perfiles;
  }

  /** Lo que distingue a cada persona dentro del perfil, para elegir con criterio. */
  private presentar(u: Usuario): UsuarioDePerfilDto {
    const partes: string[] = [];
    if (u.rol === Rol.COORDINADOR) partes.push(u.escuelas.length === 0 ? 'Área de Prácticas (todas las escuelas)' : `Escuelas: ${u.escuelas.join(', ')}`);
    else if (u.rol === Rol.TUTOR && u.escuelas.length > 0) partes.push(`Escuelas: ${u.escuelas.join(', ')}`);
    else if (u.rol === Rol.ESTUDIANTE && u.instantanea().programaId) partes.push(`Programa ${u.instantanea().programaId}`);
    if (u.permiso === 'consulta') partes.push('solo consulta');
    return { id: u.id, nombre: u.nombre, correo: u.correo, detalle: partes.join(' · ') };
  }
}
