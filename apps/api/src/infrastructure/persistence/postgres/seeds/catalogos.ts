/**
 * Semillas de catálogos oficiales. Son tablas de referencia con llave foránea:
 * el modelo no admite texto libre en ocupación, actividad económica, ubicación
 * ni nivel educativo.
 *
 * NOTA DE ALCANCE: estos son extractos representativos para el ambiente de
 * pruebas. La carga completa de CNO/CIUO-08 A.C., CIIU Rev. 4 A.C. y DIVIPOLA
 * se realiza con los archivos oficiales del DANE en el despliegue a QA.
 */

export const CNO: readonly { codigo: string; denominacion: string; nivel: string }[] = [
  { codigo: '1120', denominacion: 'Directores y gerentes generales', nivel: 'directivo' },
  { codigo: '2411', denominacion: 'Contadores', nivel: 'profesional' },
  { codigo: '2421', denominacion: 'Analistas de gestión y organización', nivel: 'profesional' },
  { codigo: '2431', denominacion: 'Profesionales de mercadeo y publicidad', nivel: 'profesional' },
  { codigo: '2512', denominacion: 'Desarrolladores de software', nivel: 'profesional' },
  { codigo: '2513', denominacion: 'Desarrolladores web y multimedia', nivel: 'profesional' },
  { codigo: '2519', denominacion: 'Analistas y programadores de software no clasificados', nivel: 'profesional' },
  { codigo: '3313', denominacion: 'Auxiliares contables', nivel: 'tecnico' },
  { codigo: '3322', denominacion: 'Representantes comerciales', nivel: 'tecnico' },
  { codigo: '3341', denominacion: 'Supervisores de oficina', nivel: 'tecnico' },
  { codigo: '3512', denominacion: 'Técnicos en soporte de tecnologías de la información', nivel: 'tecnico' },
  { codigo: '4110', denominacion: 'Oficinistas generales', nivel: 'auxiliar' },
  { codigo: '4321', denominacion: 'Empleados de control de abastecimiento e inventario', nivel: 'auxiliar' },
];

export const CIIU: readonly { codigo: string; descripcion: string; seccion: string }[] = [
  { codigo: '4711', descripcion: 'Comercio al por menor en establecimientos no especializados', seccion: 'G' },
  { codigo: '4931', descripcion: 'Transporte de pasajeros', seccion: 'H' },
  { codigo: '5210', descripcion: 'Almacenamiento y depósito', seccion: 'H' },
  { codigo: '5229', descripcion: 'Otras actividades complementarias al transporte', seccion: 'H' },
  { codigo: '6201', descripcion: 'Actividades de desarrollo de sistemas informáticos', seccion: 'J' },
  { codigo: '6202', descripcion: 'Actividades de consultoría informática', seccion: 'J' },
  { codigo: '6209', descripcion: 'Otras actividades de tecnologías de información', seccion: 'J' },
  { codigo: '6910', descripcion: 'Actividades jurídicas', seccion: 'M' },
  { codigo: '6920', descripcion: 'Actividades de contabilidad y auditoría', seccion: 'M' },
  { codigo: '7020', descripcion: 'Actividades de consultoría de gestión', seccion: 'M' },
  { codigo: '7310', descripcion: 'Publicidad', seccion: 'M' },
  { codigo: '8299', descripcion: 'Otras actividades de servicio de apoyo a las empresas', seccion: 'N' },
  { codigo: '8543', descripcion: 'Educación de universidades', seccion: 'P' },
];

export const DIVIPOLA: readonly {
  codigo: string; municipio: string; departamento: string; codigoDepartamento: string;
}[] = [
  { codigo: '11001', municipio: 'Bogotá D.C.', departamento: 'Bogotá D.C.', codigoDepartamento: '11' },
  { codigo: '05001', municipio: 'Medellín', departamento: 'Antioquia', codigoDepartamento: '05' },
  { codigo: '76001', municipio: 'Cali', departamento: 'Valle del Cauca', codigoDepartamento: '76' },
  { codigo: '08001', municipio: 'Barranquilla', departamento: 'Atlántico', codigoDepartamento: '08' },
  { codigo: '13001', municipio: 'Cartagena', departamento: 'Bolívar', codigoDepartamento: '13' },
  { codigo: '68001', municipio: 'Bucaramanga', departamento: 'Santander', codigoDepartamento: '68' },
  { codigo: '66001', municipio: 'Pereira', departamento: 'Risaralda', codigoDepartamento: '66' },
  { codigo: '17001', municipio: 'Manizales', departamento: 'Caldas', codigoDepartamento: '17' },
  { codigo: '73001', municipio: 'Ibagué', departamento: 'Tolima', codigoDepartamento: '73' },
  { codigo: '52001', municipio: 'Pasto', departamento: 'Nariño', codigoDepartamento: '52' },
  { codigo: '54001', municipio: 'Cúcuta', departamento: 'Norte de Santander', codigoDepartamento: '54' },
  { codigo: '23001', municipio: 'Montería', departamento: 'Córdoba', codigoDepartamento: '23' },
  { codigo: '50001', municipio: 'Villavicencio', departamento: 'Meta', codigoDepartamento: '50' },
  { codigo: '25754', municipio: 'Soacha', departamento: 'Cundinamarca', codigoDepartamento: '25' },
];

/** Lista tasada de niveles educativos. */
export const NIVELES_EDUCATIVOS: readonly { codigo: string; nombre: string; orden: number }[] = [
  { codigo: 'basica_primaria', nombre: 'Básica primaria', orden: 1 },
  { codigo: 'basica_secundaria', nombre: 'Básica secundaria', orden: 2 },
  { codigo: 'media', nombre: 'Media académica o técnica', orden: 3 },
  { codigo: 'tecnica_profesional', nombre: 'Técnica profesional', orden: 4 },
  { codigo: 'tecnologica', nombre: 'Tecnológica', orden: 5 },
  { codigo: 'universitaria', nombre: 'Universitaria', orden: 6 },
  { codigo: 'especializacion', nombre: 'Especialización', orden: 7 },
  { codigo: 'maestria', nombre: 'Maestría', orden: 8 },
  { codigo: 'doctorado', nombre: 'Doctorado', orden: 9 },
];

/** Escuelas de la CUN utilizadas en el ambiente de pruebas. */
export const ESCUELAS: readonly { codigo: string; nombre: string }[] = [
  { codigo: 'ESC-NEG', nombre: 'Escuela de Ciencias Administrativas y Contables' },
  { codigo: 'ESC-ING', nombre: 'Escuela de Ingenierías' },
  { codigo: 'ESC-COM', nombre: 'Escuela de Comunicación y Mercadeo' },
  { codigo: 'ESC-SOC', nombre: 'Escuela de Ciencias Sociales' },
];
