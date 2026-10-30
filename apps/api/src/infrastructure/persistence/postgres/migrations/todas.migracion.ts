import { MigrationInterface } from 'typeorm';
import { EsquemaInicial1756000000000 } from './1756000000000-EsquemaInicial';
import {
  RolAplicacionMinimoPrivilegio1756000001000,
} from './1756000001000-RolAplicacionMinimoPrivilegio';
import { CatalogosYEstado1756000002000 } from './1756000002000-CatalogosYEstado';
import { ParametrosOperativos1756000003000 } from './1756000003000-ParametrosOperativos';
import { ModalidadesRealesYEtapas1756000004000 } from './1756000004000-ModalidadesRealesYEtapas';
import { ProcesoBaseSgp1756000005000 } from './1756000005000-ProcesoBaseSgp';
import { FormularioUnicoRegistro1756000006000 } from './1756000006000-FormularioUnicoRegistro';
import { BitacoraYCierre1756000007000 } from './1756000007000-BitacoraYCierre';
import { SolicitudesArl1756000008000 } from './1756000008000-SolicitudesArl';
import { CronogramaYPqrs1756000009000 } from './1756000009000-CronogramaYPqrs';
import { ConsentimientoVersionado1756000010000 } from './1756000010000-ConsentimientoVersionado';
import { ValidacionEps1756000011000 } from './1756000011000-ValidacionEps';
import { EvidenciaEpsOcr1756000012000 } from './1756000012000-EvidenciaEpsOcr';
import { VerificacionEps1756000013000 } from './1756000013000-VerificacionEps';
import { ConsultaAdres1756000014000 } from './1756000014000-ConsultaAdres';
import { MesaEps1756000015000 } from './1756000015000-MesaEps';
import { ResponsableArlPractica1756000016000 } from './1756000016000-ResponsableArlPractica';
import { ValidacionActaIniciacion1756000017000 } from './1756000017000-ValidacionActaIniciacion';

/**
 * Migraciones declaradas una a una, en orden, igual que las entidades.
 *
 * Un comodín sobre el disco depende de `__dirname`, que cambia en cuanto el
 * código se empaqueta o se copia a otra ruta; una migración que no se encuentra
 * no falla, simplemente no corre, y eso es peor. La lista explícita también
 * deja el orden a la vista.
 */
export const MIGRACIONES: (new () => MigrationInterface)[] = [
  EsquemaInicial1756000000000,
  RolAplicacionMinimoPrivilegio1756000001000,
  CatalogosYEstado1756000002000,
  ParametrosOperativos1756000003000,
  ModalidadesRealesYEtapas1756000004000,
  ProcesoBaseSgp1756000005000,
  FormularioUnicoRegistro1756000006000,
  BitacoraYCierre1756000007000,
  SolicitudesArl1756000008000,
  CronogramaYPqrs1756000009000,
  ConsentimientoVersionado1756000010000,
  ValidacionEps1756000011000,
  EvidenciaEpsOcr1756000012000,
  VerificacionEps1756000013000,
  ConsultaAdres1756000014000,
  MesaEps1756000015000,
  ResponsableArlPractica1756000016000,
  ValidacionActaIniciacion1756000017000,
];
