import { CategoriaPqrs } from './pqrs.entity';

/**
 * Preguntas y respuestas de Desarrollo Profesional para estudiantes (documento
 * «PQRS Desarrollo Profesional», 123 preguntas en dieciséis categorías). Son
 * las mismas categorías del formulario de PQRS, así la ayuda y la solicitud
 * hablan el mismo idioma. Las rutas del SGP anterior se tradujeron a las
 * pantallas de SIPRA; el resto del texto es el institucional.
 */
export interface PreguntaFrecuente {
  readonly numero: number;
  readonly categoria: CategoriaPqrs;
  readonly pregunta: string;
  readonly respuesta: string;
}

export interface CategoriaAyuda {
  readonly clave: CategoriaPqrs;
  readonly etiqueta: string;
  /** Pantallas de SIPRA donde esta categoría es ayuda contextual. */
  readonly pantallas: readonly string[];
}

export const CATEGORIAS_AYUDA: readonly CategoriaAyuda[] = [
  { clave: 'inicio_y_requisitos_de_practicas', etiqueta: "Inicio y requisitos de prácticas", pantallas: ["inicio", "registro"] },
  { clave: 'modalidades_y_duracion_de_practicas', etiqueta: "Modalidades y duración de prácticas", pantallas: ["registro"] },
  { clave: 'carta_de_presentacion', etiqueta: "Carta de presentación", pantallas: ["registro"] },
  { clave: 'registro_y_documentos_en_sgp', etiqueta: "Registro y documentos en SGP", pantallas: ["registro", "expediente"] },
  { clave: 'afiliacion_y_cobertura_de_arl_y_eps', etiqueta: "Afiliación y cobertura de ARL y EPS", pantallas: ["arl", "expediente"] },
  { clave: 'acta_de_inicio_y_fechas', etiqueta: "Acta de Inicio y fechas", pantallas: ["expediente", "registro"] },
  { clave: 'acompanamiento_y_seguimiento_de_practicas', etiqueta: "Acompañamiento y seguimiento de prácticas", pantallas: ["expediente"] },
  { clave: 'plan_de_mejoramiento', etiqueta: "Plan de Mejoramiento", pantallas: ["expediente"] },
  { clave: 'notas_y_situacion_academica', etiqueta: "Notas y situación académica", pantallas: ["expediente"] },
  { clave: 'contrato_de_aprendizaje_y_cadena_de_formacion', etiqueta: "Contrato de aprendizaje y cadena de formación", pantallas: ["registro"] },
  { clave: 'certificados_y_experiencia_profesional', etiqueta: "Certificados y experiencia profesional", pantallas: ["pqrs"] },
  { clave: 'soporte_tecnico_del_sgp', etiqueta: "Soporte técnico del SGP", pantallas: ["pqrs"] },
  { clave: 'fechas_y_cronograma', etiqueta: "Fechas y cronograma", pantallas: ["inicio", "registro"] },
  { clave: 'tickets_y_seguimiento_de_solicitudes', etiqueta: "Tickets y seguimiento de solicitudes", pantallas: ["pqrs"] },
  { clave: 'apoyo_laboral', etiqueta: "Apoyo laboral", pantallas: ["bolsa"] },
  { clave: 'convenios', etiqueta: "Convenios", pantallas: ["registro"] },
];

export const PREGUNTAS_FRECUENTES: readonly PreguntaFrecuente[] = [
  {
    numero: 1, categoria: 'inicio_y_requisitos_de_practicas',
    pregunta: "¿Cómo inicio mi proceso de prácticas?",
    respuesta: "Para iniciar tu proceso de prácticas, debes seguir estos pasos:\nPaso 1. Verifica que tengas inscrita la asignatura de Prácticas La asignatura debe encontrarse inscrita en un periodo académico activo.\nPaso 2. Selecciona la modalidad de práctica Identifica la modalidad que deseas realizar de acuerdo con tu situación y consulta sus requisitos.\nPaso 3. Genera tu carta de presentación Una vez cumplas con los requisitos, descarga tu carta de presentación para presentarte ante la empresa o entidad donde realizarás tu práctica.\nPaso 4. Registra tu práctica en el SGP Ingresa a la plataforma y selecciona el Paso 2: “Registrar mi práctica”.\nPaso 5. Carga los documentos Después de realizar el registro, ingresa al Paso 3: “Gestionar mi práctica” y carga la documentación requerida.\nPaso 6. Consulta tu docente de prácticas Revisa la docente asignada y mantén comunicación mediante los canales institucionales establecidos.\nPaso 7. Consulta el cronograma Verifica las fechas y actividades establecidas para el desarrollo de tu práctica.",
  },
  {
    numero: 2, categoria: 'inicio_y_requisitos_de_practicas',
    pregunta: "¿Es obligatorio tener inscrita la asignatura de Prácticas?",
    respuesta: "Sí. Contar con la asignatura de Prácticas inscrita en un periodo académico activo es un requisito indispensable para iniciar, validar o formalizar el proceso de prácticas.\nPaso a paso:\nVerifica que la asignatura de Prácticas esté inscrita.\nConfirma que corresponda a un periodo académico activo.\nUna vez cumplido este requisito, podrás seleccionar la modalidad de práctica.\nPosteriormente, podrás continuar con el proceso de registro y legalización.\nSi no tienes la asignatura inscrita, actualmente no podrás iniciar ninguna modalidad de práctica.",
  },
  {
    numero: 3, categoria: 'inicio_y_requisitos_de_practicas',
    pregunta: "¿Qué debo tener en cuenta antes de iniciar mi práctica?",
    respuesta: "Antes de iniciar tu práctica, verifica los siguientes aspectos:\n☐ Tener la asignatura de Prácticas inscrita en un periodo académico activo.\n☐ Seleccionar la modalidad de práctica correspondiente.\n☐ Conocer los requisitos y duración de la modalidad seleccionada.\n☐ Generar la carta de presentación, cuando corresponda.\n☐ Encontrar la empresa o entidad donde desarrollarás tu práctica.\n☐ Realizar el registro de la práctica en el SGP.\n☐ Cargar la documentación requerida en el SGP.\n☐ Consultar la docente asignada.\n☐ Revisar el cronograma de prácticas.\n☐ Verificar que la ARL se encuentre gestionada antes de iniciar actividades relacionadas con la práctica.\n☐ Mantener comunicación con la docente mediante los canales institucionales.\nImportante: la asignatura de Prácticas no se desarrolla mediante clases tradicionales. El proceso inicia con una inducción a cargo de la docente asignada y posteriormente se realizan asesorías programadas de acuerdo con las orientaciones y el cronograma establecido.",
  },
  {
    numero: 4, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Qué modalidades de práctica puedo realizar?",
    respuesta: "La institución cuenta con diferentes modalidades de práctica:\nContrato de Aprendizaje Validación de Experiencia Laboral Combinación de Funciones Pasantía Monitoría Empresa Propia – CUNBRE Práctica Social Práctica de Investigación ¿Qué debo hacer?\nPaso 1. Revisa las características de cada modalidad.\nPaso 2. Identifica cuál se ajusta a tu situación.\nPaso 3. Verifica los requisitos correspondientes.\nPaso 4. Selecciona la modalidad con la que desarrollarás tu práctica.",
  },
  {
    numero: 5, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Cuál es la duración de cada modalidad?",
    respuesta: "La duración depende de la modalidad seleccionada. El contrato de aprendizaje tiene una duración de 6 meses.\nExcepto el Contrato de Aprendizaje, las modalidades deben iniciar y finalizar dentro del periodo académico en el que se encuentra inscrita la asignatura.",
  },
  {
    numero: 6, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Puedo homologar la asignatura de Prácticas con mi trabajo actual?",
    respuesta: "La asignatura de Prácticas no es susceptible de homologación. No obstante, si cuenta con una vinculación laboral vigente, puede optar por la modalidad de Validación de Experiencia Laboral. La aprobación dependerá de que las funciones desempeñadas concuerden directamente con las competencias del programa académico.",
  },
  {
    numero: 7, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Qué es la herramienta GEMA y cómo me ayuda antes de inscribir la práctica?",
    respuesta: "Como apoyo previo, puedes utilizar la herramienta GEMA, que te permitirá realizar un análisis preliminar sobre la relación entre tus funciones laborales y tu programa académico, antes de iniciar el proceso formal.\n Para realizar el análisis, deberás cargar:\n• Certificado laboral con fecha de expedición no mayor a 30 días, donde se indiquen tu cargo y funciones actuales.\n• Infografía de funciones de tu carrera, disponible en el siguiente enlace: Consultar infografías de funciones Recuerda: El resultado de GEMA es únicamente orientativo y no representa la aprobación de la modalidad. La validación definitiva será realizada por la persona docente mediante el proceso establecido en el SGP.",
  },
  {
    numero: 8, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Puedo solicitar la extensión del tiempo de duración de mi pasantía?",
    respuesta: "Sí, la extensión es posible previa validación de la Coordinación de Prácticas. Para iniciar el trámite, es indispensable que la empresa o entidad receptora remita una solicitud formal desde su correo corporativo a practicas@cun.edu.co, con copia al docente facilitador de prácticas, indicando los datos del estudiante, la justificación y el periodo de ampliación requerido. La solicitud debe ser gestionada directamente por la organización.",
  },
  {
    numero: 9, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Qué modalidades de práctica existen?",
    respuesta: "Las modalidades se organizan en Articuladas/Internas y Externas. Cada una tiene requisitos y condiciones específicas que deben consultarse antes de realizar el registro.",
  },
  {
    numero: 10, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Qué modalidades son Articuladas/Internas?",
    respuesta: "Dentro de estas se encuentran Monitorías, Proyección Social, CUNbre y Semilleros.",
  },
  {
    numero: 11, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Qué modalidades son Externas?",
    respuesta: "Dentro de estas se encuentran Contrato de Aprendizaje, Pasantía, Validación de Experiencia Laboral y Combinación de Funciones.",
  },
  {
    numero: 12, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Cuál es la diferencia entre Pasantía y Contrato de Aprendizaje?",
    respuesta: "Son modalidades diferentes y cada una tiene condiciones, documentos y procesos propios. Antes de registrarte, revisa los requisitos correspondientes a cada modalidad.",
  },
  {
    numero: 13, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Qué es la Validación de Experiencia Laboral?",
    respuesta: "Es una modalidad mediante la cual se puede validar una experiencia laboral que cumpla con las condiciones establecidas y que tenga relación con el programa y nivel de formación correspondiente.",
  },
  {
    numero: 14, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Qué es la Combinación de Funciones?",
    respuesta: "Es una modalidad en la que el estudiante desarrolla, dentro de su actividad laboral, funciones relacionadas con las competencias de su programa académico y que pueden ser validadas como práctica, de acuerdo con los requisitos institucionales.",
  },
  {
    numero: 15, categoria: 'modalidades_y_duracion_de_practicas',
    pregunta: "¿Puedo cambiar de modalidad después de iniciar mi práctica?",
    respuesta: "Cualquier cambio debe ser consultado y autorizado según el procedimiento correspondiente. No debes modificar por tu cuenta la modalidad registrada.",
  },
  {
    numero: 16, categoria: 'carta_de_presentacion',
    pregunta: "¿Cómo genero mi carta de presentación?",
    respuesta: "La carta de presentación es el documento que puedes utilizar para presentarte ante la empresa o entidad donde desarrollarás tu práctica.\nPaso a paso:\nPaso 1. Verifica que tengas la asignatura de Prácticas inscrita en un periodo académico vigente.\nPaso 2. Ingresa a SIPRA, menú «Registrar mi práctica», paso 1 «Carta de presentación».\nPaso 3. Verifica que tus datos personales y académicos estén completos y actualizados.\nPaso 4. Genera y descarga la carta.\nPaso 5. Envía la carta a la empresa o entidad donde deseas realizar tu práctica.\nImportante: antes de iniciar cualquier actividad relacionada con la práctica, verifica que el proceso de afiliación a la ARL se encuentre debidamente gestionado.",
  },
  {
    numero: 17, categoria: 'carta_de_presentacion',
    pregunta: "¿Por qué no puedo descargar mi carta de presentación?",
    respuesta: "Una de las razones puede ser que no tengas la asignatura de Prácticas inscrita en un periodo académico vigente.\n¿Qué debo hacer?\nPaso 1. Verifica tu matrícula académica.\nPaso 2. Confirma que la asignatura de Prácticas esté inscrita.\nPaso 3. Verifica que el periodo académico se encuentre vigente.\nPaso 4. Una vez cumplas estas condiciones, podrás realizar nuevamente el proceso para generar tu carta de presentación.\nLa carta de presentación únicamente puede ser expedida cuando la asignatura de Prácticas se encuentra debidamente inscrita en un periodo académico activo.",
  },
  {
    numero: 18, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Cómo registro mi práctica en el SGP?",
    respuesta: "Una vez hayas seleccionado la modalidad de práctica, debes realizar el registro en el Sistema de Gestión de Prácticas (SGP).\n1. Ingresa al Sistema de Gestión de Prácticas (SGP):\nhttps://bienestaru.cun.edu.co/fur_nuevo_registro.php\n2. Accede con tu correo institucional como usuario y tu número de documento de identidad como contraseña.\n3. Selecciona el Paso 2: “Registrar mi práctica”.\n4. Diligencia el formulario con la información de tu práctica y de la empresa o entidad.\n5. Verifica que los datos sean correctos y finaliza el registro.",
  },
  {
    numero: 19, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué debo hacer después de registrar mi práctica y cómo cargo los documentos?",
    respuesta: "1. Ingresa al SGP con tu correo institucional y tu número de documento de identidad.\n2. Selecciona el Paso 3: “Gestionar mi práctica”.\n3. En el recuadro con la información de tu práctica, haz clic sobre el porcentaje de avance para acceder al cargue de documentos.\n4. Carga los documentos requeridos según tu modalidad y verifica que estén completos y correctamente cargados.\nConsulta los documentos de cada modalidad en el siguiente enlace:\nhttps://sites.google.com/cun.edu.co/practicascun/tipos-de-pr%C3%A1cticas-presencial-distancia?authuser=0\n5. Consulta al docente asignado, mantén comunicación durante el proceso y revisa el cronograma de prácticas.",
  },
  {
    numero: 20, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Cuántos días después de terminada mi práctica tengo para realizar el cargue de los documentos pendientes?",
    respuesta: "Una vez finalizada tu práctica, cuentas con 8 días calendario para realizar el cargue de la documentación que tengas pendiente en el Sistema de Gestión de Prácticas (SGP).\nTe recomendamos realizar el cargue dentro del plazo establecido para facilitar la revisión de los documentos y el cierre oportuno de tu práctica.",
  },
  {
    numero: 21, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Cómo puedo solicitar a mi docente la anulación de un registro de práctica?",
    respuesta: "Para solicitar la anulación de un registro de práctica, debes comunicarte directamente con tu docente asignado a través de la bitácora del SGP o su correo institucional.\nDebes indicarle que necesitas realizar una corrección en el registro y solicitar la anulación del registro actual.\nUna vez el docente realice la anulación, podrás ingresar nuevamente al Sistema de Gestión de Prácticas (SGP) y realizar el registro con la información correcta.\nRecuerda verificar cuidadosamente los datos antes de enviar nuevamente el registro, especialmente las fechas de inicio y finalización de la práctica.",
  },
  {
    numero: 22, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué debo hacer si no puedo registrar mi práctica en el SGP por ser estudiante en el extranjero o por un error técnico?",
    respuesta: "En caso de presentar bloqueos en la plataforma SGP o encontrarse fuera del país, debe remitir los siguientes datos completos de la empresa receptora a través del canal oficial para efectuar el registro manual:\nNombre de la empresa y NIT.\nModalidad, área, cargo y horario de la práctica.\nFechas de inicio y finalización.\nDatos del jefe inmediato (nombre, correo corporativo y teléfono de contacto).\nCiudad y listado detallado de funciones a desempeñar.",
  },
  {
    numero: 23, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué hago si registré mal mi práctica?",
    respuesta: "No continúes cargando documentos sin antes revisar el error. Comunícate por el canal establecido para recibir orientación sobre si es necesario corregir la información o realizar nuevamente el registro.",
  },
  {
    numero: 24, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Puedo cambiar la información después de registrar mi práctica?",
    respuesta: "Depende del dato que necesites modificar. Algunas modificaciones requieren una gestión adicional o incluso anular el registro para realizar uno nuevo.",
  },
  {
    numero: 25, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué hago si escogí una modalidad equivocada?",
    respuesta: "Solicita orientación antes de modificar el registro. Cada modalidad tiene requisitos y documentos diferentes, por lo que es importante que la información registrada corresponda a tu práctica real.",
  },
  {
    numero: 26, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Cómo sé si mi registro quedó correctamente realizado?",
    respuesta: "Después de finalizar el registro, revisa la información que aparece en el SGP. Verifica especialmente la modalidad, empresa, fechas, programa y demás datos asociados a tu práctica.",
  },
  {
    numero: 27, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Puedo registrar mi práctica si todavía no tengo todos los documentos?",
    respuesta: "Debes seguir las condiciones establecidas para el registro de tu modalidad. Una vez registrado el proceso, asegúrate de completar posteriormente todos los documentos requeridos.",
  },
  {
    numero: 28, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué documentos debo presentar?",
    respuesta: "Los documentos dependen de la modalidad de práctica. Consulta los requisitos y formatos oficiales publicados en el Site de Prácticas CUN antes de realizar el cargue.",
  },
  {
    numero: 29, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Dónde encuentro los formatos de prácticas?",
    respuesta: "Los formatos oficiales se encuentran en el Site de Prácticas CUN. Utiliza siempre la versión correspondiente a tu proceso y evita utilizar formatos de otros periodos, modalidades o actividades.",
  },
  {
    numero: 30, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Puedo utilizar un formato diferente al que aparece en el Site?",
    respuesta: "No es recomendable. Debes utilizar el formato institucional correspondiente al documento que te están solicitando, ya que los formatos pueden tener requisitos diferentes.",
  },
  {
    numero: 31, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿En qué formato debo cargar los documentos?",
    respuesta: "Los documentos deben cargarse en PDF, salvo que se indique expresamente otro formato. Antes de cargarlos, verifica que sean completos, legibles y que correspondan al documento solicitado.",
  },
  {
    numero: 32, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Por qué rechazaron un documento que ya había cargado?",
    respuesta: "Porque durante la revisión se encontró alguna inconsistencia o falta de cumplimiento. Lee la observación registrada, realiza el ajuste solicitado y vuelve a cargar el documento.",
  },
  {
    numero: 33, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué hago si no entiendo la observación de un documento?",
    respuesta: "Lee nuevamente la observación registrada en el SGP. Si después de revisarla aún tienes dudas, solicita orientación indicando exactamente qué documento y qué observación necesitas aclarar.",
  },
  {
    numero: 34, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Cuánto tarda la revisión de un documento?",
    respuesta: "La revisión depende del volumen de solicitudes y de las condiciones del proceso. Una vez cargado el documento, debes revisar periódicamente el SGP para conocer su estado.",
  },
  {
    numero: 35, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Debo enviar los documentos también por correo?",
    respuesta: "El SGP es el medio principal para el cargue y seguimiento de los documentos. Si se requiere enviar algún soporte adicional por correo, se te indicará expresamente.",
  },
  {
    numero: 36, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué pasa si cargué un documento equivocado?",
    respuesta: "Revisa si el SGP permite reemplazarlo. Si no puedes hacerlo, solicita orientación para realizar correctamente el cambio y evitar que el documento quede pendiente o rechazado.",
  },
  {
    numero: 37, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Qué pasa si mi documento está borroso?",
    respuesta: "Debes volver a cargar una versión que pueda leerse claramente. La información, fechas, nombres, firmas y demás datos deben ser visibles.",
  },
  {
    numero: 38, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Cuál es el sistema oficial para consultar mi proceso?",
    respuesta: "El SGP es la fuente oficial de consulta del proceso de prácticas. Allí puedes revisar el estado de tus documentos, avances y observaciones.",
  },
  {
    numero: 39, categoria: 'registro_y_documentos_en_sgp',
    pregunta: "¿Debo revisar constantemente el SGP?",
    respuesta: "Sí. Es importante revisar periódicamente el estado de tu proceso para identificar documentos rechazados, solicitudes de corrección o actividades pendientes.",
  },
  {
    numero: 40, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Cómo puedo realizar mi solicitud de ARL?",
    respuesta: "Puedes realizar tu solicitud de afiliación a la ARL a través del siguiente enlace:\nSolicitud de ARL Puedes solicitar la afiliación de ARL directamente con la CUN si tu práctica corresponde a alguna de las siguientes modalidades:\nMonitoría Semillero CUNBRE Proyección social Pasantía directamente con la CUN Pasantía con entidades del tercer sector (sin ánimo de lucro) Es importante que la solicitud de ARL se encuentre registrada y vigente antes de iniciar tu práctica, con el fin de garantizar la cobertura durante el desarrollo de esta.",
  },
  {
    numero: 41, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Cómo puedo consultar el estado de mi solicitud de ARL?",
    respuesta: "El estado de tu solicitud de ARL será notificado a través de tu correo electrónico institucional. Sin embargo, también puedes consultar directamente el estado de tu solicitud mediante el siguiente enlace:\nhttps://portalarl.cunapp.pro/#/formulario/consultaEstadoSolicitud Si tu solicitud es aprobada, recibirás el certificado de afiliación a la ARL en un plazo de 3 a 5 días hábiles.\nEn caso de que la solicitud sea rechazada, deberás realizar nuevamente el proceso de solicitud, verificando previamente la información y documentación requerida.",
  },
  {
    numero: 42, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿La empresa donde voy a realizar mi práctica es la encargada de gestionar y asumir mi afiliación a la ARL?",
    respuesta: "De acuerdo con el Decreto 055 de 2015, cuando realizas tu práctica en una empresa o entidad que no pertenece al tercer sector, la afiliación y el pago de los aportes al Sistema General de Riesgos Laborales (ARL) estarán a cargo de la entidad donde desarrollas la práctica.\nEl Capítulo II – Afiliación y pago de aportes, Artículo 4, numeral 2, literal d) establece que:\n“La entidad, empresa o institución pública o privada donde se realice la práctica [...]” será la encargada de la afiliación y el pago de los aportes al Sistema General de Riesgos Laborales, sin perjuicio de los acuerdos que existan entre la institución educativa y la entidad donde se realiza la práctica.\nPor lo anterior, si realizas tu práctica en una empresa que no pertenece al tercer sector, será esta entidad la encargada de gestionar y asumir tu afiliación a la ARL durante el periodo de práctica, de acuerdo con la normativa vigente y los acuerdos establecidos con la institución educativa.\nImportante: Antes de iniciar tu práctica, verifica con la empresa que el proceso de afiliación a la ARL haya sido realizado correctamente, con el fin de contar con la cobertura correspondiente durante el desarrollo de tus actividades.",
  },
  {
    numero: 43, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Por qué debo presentar el certificado de ARL?",
    respuesta: "La ARL permite verificar que cuentas con la cobertura correspondiente durante el desarrollo de la práctica, de acuerdo con las condiciones de tu modalidad.",
  },
  {
    numero: 44, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Qué hago si mi ARL no aparece activa?",
    respuesta: "Primero debes verificar la información con la empresa y con la administradora de riesgos laborales. Si existe una inconsistencia, solicita el soporte correspondiente y preséntalo para su validación.",
  },
  {
    numero: 45, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Qué hago si la empresa dice que sí me afilió, pero la ARL no aparece?",
    respuesta: "Solicita a la empresa un soporte que permita comprobar la afiliación y las fechas de cobertura. Con este documento se podrá realizar la revisión correspondiente.",
  },
  {
    numero: 46, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Qué hago si las fechas de la ARL no coinciden con mi práctica?",
    respuesta: "Debes solicitar a la empresa la revisión de la afiliación y la corrección que corresponda. Las fechas de cobertura deben ser coherentes con el desarrollo de la práctica.",
  },
  {
    numero: 47, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Qué documento puedo pedirle a la empresa para verificar la ARL?",
    respuesta: "Puedes solicitar el soporte o comprobante que permita demostrar la afiliación y cobertura correspondiente. Si se requiere un documento específico, se te indicará durante la validación.",
  },
  {
    numero: 48, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Puedo adquirir el ARL como independiente?",
    respuesta: "No, no puedes presentar tu ARL como independiente para las prácticas académicas. La afiliación a la ARL debe ser gestionada directamente por la empresa o entidad donde realizarás la práctica (quien asume la cotización), o únicamente por la CUN si tu modalidad es Monitoría, Pasantía en la CUN, CUNBRE, Práctica Social, Investigación o Entidades del Tercer Sector.",
  },
  {
    numero: 49, categoria: 'afiliacion_y_cobertura_de_arl_y_eps',
    pregunta: "¿Qué certificado de EPS debo presentar?",
    respuesta: "Debes presentar el certificado de afiliación a EPS solicitado para tu proceso. Verifica que corresponda a tu información personal y que sea legible y vigente según el requisito establecido.(ten en cuenta que no se aceptan el certificado del ADRES ni planillas de pago). El documento no puede estar protegido con contraseña.",
  },
  {
    numero: 50, categoria: 'acta_de_inicio_y_fechas',
    pregunta: "¿Para qué sirve el Acta de Inicio?",
    respuesta: "Es el documento que formaliza el inicio de la práctica y permite dejar registrados datos importantes como las partes involucradas, la modalidad y las fechas correspondientes.",
  },
  {
    numero: 51, categoria: 'acta_de_inicio_y_fechas',
    pregunta: "¿Qué fechas debo colocar en el Acta de Inicio?",
    respuesta: "Debes utilizar las fechas reales y autorizadas para el desarrollo de tu práctica, de acuerdo con las condiciones de tu modalidad y los documentos que soportan el proceso.",
  },
  {
    numero: 52, categoria: 'acta_de_inicio_y_fechas',
    pregunta: "¿Qué hago si las fechas del Acta están mal?",
    respuesta: "Debes solicitar la corrección antes de continuar con el proceso. Es importante que las fechas del Acta sean coherentes con los demás documentos de la práctica.",
  },
  {
    numero: 53, categoria: 'acta_de_inicio_y_fechas',
    pregunta: "¿Qué pasa si la empresa no quiere cambiar el Acta?",
    respuesta: "Informa la situación y presenta el documento disponible para que pueda ser revisado. Dependiendo del caso, se podrá solicitar un soporte adicional o indicar el procedimiento que corresponda.",
  },
  {
    numero: 54, categoria: 'acta_de_inicio_y_fechas',
    pregunta: "¿Qué pasa si las fechas del Acta, ARL y contrato son diferentes?",
    respuesta: "La diferencia debe ser revisada y aclarada. Los documentos que soportan la práctica deben guardar coherencia en fechas y demás datos relevantes.",
  },
  {
    numero: 55, categoria: 'acta_de_inicio_y_fechas',
    pregunta: "¿Quién debe firmar el Acta de Inicio?",
    respuesta: "Las firmas requeridas dependen de la modalidad y del formato institucional utilizado. Revisa las instrucciones del formato antes de cargarlo.",
  },
  {
    numero: 56, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Cómo consulto quién es mi docente de prácticas asignado?",
    respuesta: "Una vez el periodo académico esté activo y se realice la asignación, puedes consultar a tu docente en el Power BI de prácticas o ingresando al Sistema de Gestión de Prácticas (SGP).\nEn SIPRA aparece en la cabecera de tu expediente. Mantén seguimiento de las indicaciones, el cronograma y las actividades mediante el correo institucional y las bitácoras del SGP.",
  },
  {
    numero: 57, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Cómo puedo comunicarme con mi docente asignado?",
    respuesta: "Para comunicarte con tu docente de prácticas asignado, puedes utilizar los canales de comunicación establecidos por la CUN:\nCorreo institucional del docente.\nBitácora del Sistema de Gestión de Prácticas (SGP).\nTe recomendamos utilizar estos canales para realizar consultas, solicitar orientación o hacer seguimiento a tu proceso de prácticas.",
  },
  {
    numero: 58, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Qué debo hacer si tengo pendiente una revisión o aprobación por parte del docente?",
    respuesta: "Si tienes pendiente una revisión, aprobación o respuesta por parte de tu docente de prácticas, debes comunicarte directamente con él a través de los canales de comunicación establecidos, como el correo institucional o la bitácora del SGP.\nTe recomendamos realizar la solicitud por estos medios y hacer seguimiento a tu proceso para conocer el estado de la revisión.",
  },
  {
    numero: 59, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Debo realizar seguimientos durante mi práctica?",
    respuesta: "Sí. El seguimiento hace parte del proceso de prácticas y permite verificar el desarrollo de la experiencia y el cumplimiento de las actividades establecidas.",
  },
  {
    numero: 60, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Dónde puedo consultar mis seguimientos?",
    respuesta: "Debes consultar el estado de tus seguimientos en el SGP, de acuerdo con las etapas habilitadas para tu proceso.",
  },
  {
    numero: 61, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Qué hago si no me aparece un seguimiento en el SGP?",
    respuesta: "Verifica primero que corresponda a la etapa de tu proceso. Si debería aparecer y no está disponible, reporta la situación por el canal correspondiente.",
  },
  {
    numero: 62, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Qué formato debo utilizar para el seguimiento final?",
    respuesta: "Debes utilizar el Formato de Seguimiento Final de Prácticas correspondiente. No debes utilizar formatos de otras modalidades o estrategias institucionales.",
  },
  {
    numero: 63, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Qué pasa si utilicé un formato que no correspondía?",
    respuesta: "Deberás diligenciar el formato correcto y cargarlo nuevamente para que pueda ser revisado y validado.",
  },
  {
    numero: 64, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Por qué mi seguimiento todavía no aparece aprobado?",
    respuesta: "Que el documento esté cargado no significa que ya esté aprobado. Debe pasar por el proceso de revisión correspondiente.",
  },
  {
    numero: 65, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Qué pasa si no entiendo qué debo hacer?",
    respuesta: "Primero revisa la información disponible en el Site de Prácticas CUN y las observaciones registradas en el SGP.\nSi la duda continúa, solicita orientación indicando claramente cuál es tu situación.",
  },
  {
    numero: 66, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Puedo esperar hasta que el docente me diga que tengo algo pendiente?",
    respuesta: "No. Es responsabilidad del estudiante revisar su proceso, consultar el SGP y atender oportunamente las observaciones y fechas establecidas.",
  },
  {
    numero: 67, categoria: 'acompanamiento_y_seguimiento_de_practicas',
    pregunta: "¿Dónde encuentro información general sobre las prácticas?",
    respuesta: "Puedes consultar el Site de Prácticas CUN, donde se encuentra información sobre modalidades, requisitos, formatos, tutoriales, cronogramas y otros aspectos del proceso.",
  },
  {
    numero: 68, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Qué es el Plan de Mejoramiento?",
    respuesta: "Es un trabajo académico en el que identificas una situación real de tu escenario de práctica y planteas una propuesta para mejorarla.",
  },
  {
    numero: 69, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Sobre qué puedo hacer mi Plan de Mejoramiento?",
    respuesta: "Debe tratar sobre una situación real relacionada con tu práctica y estar conectada con tu programa académico.\nNo se trata simplemente de escoger cualquier tema.",
  },
  {
    numero: 70, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Mi propuesta debe estar relacionada con lo que estudio?",
    respuesta: "Sí. Debes demostrar que puedes aplicar los conocimientos y competencias de tu programa en una situación real de tu escenario de práctica.",
  },
  {
    numero: 71, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Cómo identifico el problema para mi Plan de Mejoramiento?",
    respuesta: "Primero debes observar y conocer la situación. Después debes recopilar evidencias que te permitan explicar qué está ocurriendo, por qué ocurre y por qué es necesario mejorar.",
  },
  {
    numero: 72, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Puedo proponer una mejora sin hacer un diagnóstico?",
    respuesta: "No es recomendable. La propuesta debe estar sustentada en un diagnóstico que permita demostrar que la situación realmente existe y que la mejora propuesta responde a una necesidad.",
  },
  {
    numero: 73, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Tengo que implementar mi propuesta?",
    respuesta: "Cuando las condiciones lo permitan, se espera que la propuesta pueda desarrollarse y que presentes las evidencias correspondientes. Si existen restricciones que impiden implementarla, estas deben quedar claramente explicadas y sustentadas.",
  },
  {
    numero: 74, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Qué evidencias puedo presentar?",
    respuesta: "Las evidencias dependen de la propuesta. Pueden incluir documentos, registros, fotografías, capturas, resultados, productos elaborados u otros soportes que permitan demostrar el trabajo realizado.",
  },
  {
    numero: 75, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Cómo se evalúa el Plan de Mejoramiento?",
    respuesta: "Se revisa, entre otros aspectos, la pertinencia, diagnóstico, problema, objetivos, justificación, fundamentación, propuesta, planificación, indicadores, evidencias, resultados, conclusiones y presentación académica.",
  },
  {
    numero: 76, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Qué pasa si mi Plan de Mejoramiento necesita correcciones?",
    respuesta: "Debes revisar las observaciones realizadas por el docente, realizar los ajustes solicitados y presentar nuevamente el documento dentro del tiempo establecido.",
  },
  {
    numero: 77, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Puedo copiar una propuesta de otro estudiante?",
    respuesta: "No. El Plan de Mejoramiento debe ser un trabajo individual y estar relacionado con la realidad de tu propio escenario de práctica.",
  },
  {
    numero: 78, categoria: 'plan_de_mejoramiento',
    pregunta: "¿Puedo utilizar inteligencia artificial en mi Plan de Mejoramiento?",
    respuesta: "Si la institución establece condiciones para su uso, debes cumplirlas y declarar su utilización cuando corresponda. La información, análisis, evidencias y decisiones del trabajo deben corresponder realmente a tu proceso.",
  },
  {
    numero: 79, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Cuándo podré consultar mi nota de prácticas?",
    respuesta: "La nota se verá reflejada al finalizar el periodo académico, una vez completado el proceso correspondiente.\nPara que se pueda registrar la nota, debes completar previamente la actividad “Evalúa tu proceso”, disponible en el SGP.\nVerifica que hayas realizado esta actividad y revisa periódicamente las plataformas para confirmar el registro de tu calificación.",
  },
  {
    numero: 80, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Por qué mi nota aparece en SGP y CDigital, pero aún no se refleja en SINU?",
    respuesta: "La migración de la nota a SINU puede tardar de 10 a 15 días hábiles. Revisa periódicamente el sistema para verificar que la calificación se haya reflejado.",
  },
  {
    numero: 81, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué debo hacer si ya aprobé Prácticas y la asignatura aparece inscrita nuevamente?",
    respuesta: "Si tu proceso en SGP ya está cerrado con nota y la asignatura aparece inscrita nuevamente en SINU, debes crear un ticket solicitando el retiro de obligatoriedad.",
  },
  {
    numero: 82, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Cuál es una causa común de reprobación de la asignatura de Prácticas?",
    respuesta: "No contar con el registro de la práctica en SGP para el periodo correspondiente dentro de los tiempos establecidos en el cronograma de prácticas.",
  },
  {
    numero: 83, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué sucede si se gestiona el retiro de la obligatoriedad de la materia de Prácticas?",
    respuesta: "Una vez autorizado y procesado el retiro de obligatoriedad, no requerirá cursar la asignatura de Prácticas. Los créditos académicos correspondientes serán trasladados a otra asignatura de su plan de estudios, según la programación y disponibilidad de la oferta académica.",
  },
  {
    numero: 84, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Cuándo se cierra mi práctica?",
    respuesta: "El proceso se cierra cuando se han cumplido los requisitos académicos y documentales establecidos para la modalidad y no existen pendientes que impidan la aprobación.",
  },
  {
    numero: 85, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Cómo sé si mi práctica ya está cerrada?",
    respuesta: "Revisa el estado de tu proceso en el SGP y verifica que los documentos y actividades requeridas hayan sido validados.",
  },
  {
    numero: 86, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Por qué entregué todo y todavía no tengo nota?",
    respuesta: "Primero se debe realizar la revisión y validación del proceso. La nota se asigna una vez se cumplen las condiciones necesarias para el cierre.",
  },
  {
    numero: 87, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Por qué mi nota todavía no aparece en SINU?",
    respuesta: "La calificación debe pasar por el proceso institucional correspondiente antes de reflejarse definitivamente en SINU. Por eso, puede existir un tiempo entre el cierre de la práctica y la actualización de la nota.",
  },
  {
    numero: 88, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué pasa si en SINU aparece una nota provisional?",
    respuesta: "No necesariamente significa que sea la calificación definitiva. Primero verifica el estado de tu proceso en el SGP y espera la actualización correspondiente.",
  },
  {
    numero: 89, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Cuándo se realiza la migración de la nota a SINU?",
    respuesta: "La migración se realiza de acuerdo con los procesos y tiempos institucionales establecidos. El estudiante debe consultar los canales oficiales para conocer las actualizaciones correspondientes.",
  },
  {
    numero: 90, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué pasa si todavía tengo documentos pendientes?",
    respuesta: "El proceso no podrá considerarse completamente cerrado mientras existan documentos o actividades pendientes que sean necesarios para la aprobación.",
  },
  {
    numero: 91, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué pasa si no corrijo un documento?",
    respuesta: "Si no atiendes una corrección solicitada, el documento puede permanecer rechazado o pendiente y esto puede impedir el cierre y aprobación de tu práctica.",
  },
  {
    numero: 92, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué pasa si no entrego los documentos dentro del plazo?",
    respuesta: "Debes cumplir las fechas establecidas en el cronograma y las comunicaciones institucionales. No atender los requisitos dentro de los tiempos establecidos puede afectar la aprobación del proceso",
  },
  {
    numero: 93, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué debo hacer para aprobar mi práctica?",
    respuesta: "Debes cumplir con las actividades de tu modalidad, entregar todos los documentos requeridos, atender las correcciones, desarrollar los productos académicos solicitados y cumplir las fechas establecidas.",
  },
  {
    numero: 94, categoria: 'notas_y_situacion_academica',
    pregunta: "¿Qué pasa si no cumplo con los requisitos de la práctica?",
    respuesta: "El incumplimiento de los requisitos académicos, documentales o administrativos puede impedir la aprobación y el cierre del proceso. Según el caso, puede ser necesario cursar nuevamente la práctica.",
  },
  {
    numero: 95, categoria: 'contrato_de_aprendizaje_y_cadena_de_formacion',
    pregunta: "¿Cómo sé si cumplo con la cadena de formación ?",
    respuesta: "Debes cumplir con la misma cadena de formación y estudiar la misma carrera.\nSolicitar el desbloqueo por un nivel superior por ejemplo, si realizaste el anterior Contrato por nivel Técnico, podrás desbloquear un segundo contrato por nivel profesional.",
  },
  {
    numero: 96, categoria: 'contrato_de_aprendizaje_y_cadena_de_formacion',
    pregunta: "¿Cuáles documentos debo adjuntar para hacer el desbloqueo de aprendizaje?",
    respuesta: "Copia del acta o diploma de grado del nivel de formación para el cual se realizó el contrato de aprendizaje.\nCarta de terminación de contrato (certificación que entrega la empresa).",
  },
  {
    numero: 97, categoria: 'contrato_de_aprendizaje_y_cadena_de_formacion',
    pregunta: "¿Quién registra mi contrato de aprendizaje?",
    respuesta: "La empresa en la cual desarrollarás tu práctica.",
  },
  {
    numero: 98, categoria: 'certificados_y_experiencia_profesional',
    pregunta: "¿Qué requisitos debo presentar para solicitar la Carta 616 para mi tarjeta profesional?",
    respuesta: "Para la expedición de la Certificación de Equivalencia de Experiencia Profesional (Decreto 616 de 2021), es necesario enviar a través del sistema de tickets los siguientes documentos obligatorios:\nCopia del documento de identidad.\nCertificado de funciones emitido por la empresa en donde realizó su último proceso de práctica.\nCopia del diploma o acta de grado del título profesional.",
  },
  {
    numero: 99, categoria: 'certificados_y_experiencia_profesional',
    pregunta: "¿Para qué sirve la Certificación de Experiencia Profesional (Carta 616)?",
    respuesta: "Este documento avala que las actividades realizadas durante sus prácticas empresariales, contratos de aprendizaje, judicaturas, contratos laborales o monitorías son equivalentes a experiencia técnico- contable/profesional, requisito exigido por entidades como la Junta Central de Contadores (JCC).",
  },
  {
    numero: 100, categoria: 'certificados_y_experiencia_profesional',
    pregunta: "¿Cómo solicito el Certificado de Prácticas de una materia ya aprobada?",
    respuesta: "Una vez culminado y aprobado el proceso de prácticas en el sistema, podrá solicitar la expedición del certificado oficial a través de la mesa de ayuda o ticket de soporte administrativo.",
  },
  {
    numero: 101, categoria: 'soporte_tecnico_del_sgp',
    pregunta: "¿Qué hago si no puedo ingresar al SGP?",
    respuesta: "Primero verifica tus datos de acceso. Si el problema continúa, debes reportarlo por el canal institucional de soporte correspondiente (Camiticket a mesa de ayuda).",
  },
  {
    numero: 102, categoria: 'soporte_tecnico_del_sgp',
    pregunta: "¿Qué hago si no aparece mi práctica en el SGP?",
    respuesta: "Verifica que hayas realizado correctamente el registro. Si la práctica debería aparecer y no está disponible, reporta la situación para que pueda ser revisada.",
  },
  {
    numero: 103, categoria: 'soporte_tecnico_del_sgp',
    pregunta: "¿Qué hago si no puedo cargar un documento?",
    respuesta: "Revisa que el archivo esté en el formato solicitado, sea legible y cumpla con las condiciones de cargue. Si el problema continúa, reporta la falla por el canal correspondiente.",
  },
  {
    numero: 104, categoria: 'soporte_tecnico_del_sgp',
    pregunta: "¿Qué hago si el SGP muestra información incorrecta?",
    respuesta: "No continúes el proceso sin informar la situación. Reporta el dato incorrecto para recibir orientación sobre la forma adecuada de corregirlo.",
  },
  {
    numero: 105, categoria: 'soporte_tecnico_del_sgp',
    pregunta: "¿Qué hago si el sistema presenta un error?",
    respuesta: "Toma una evidencia del error, identifica qué estabas intentando realizar y repórtalo por el canal institucional correspondiente. Esto facilita la revisión del inconveniente.",
  },
  {
    numero: 106, categoria: 'fechas_y_cronograma',
    pregunta: "¿Dónde puedo consultar las fechas importantes?",
    respuesta: "Debes consultar el cronograma vigente de prácticas publicado por la institución. Las fechas pueden cambiar entre periodos académicos.",
  },
  {
    numero: 107, categoria: 'fechas_y_cronograma',
    pregunta: "¿Cuál es la fecha límite para cargar documentos?",
    respuesta: "La fecha depende del periodo académico y del cronograma vigente. Es responsabilidad del estudiante revisar las fechas oficiales y realizar los cargues oportunamente.",
  },
  {
    numero: 108, categoria: 'fechas_y_cronograma',
    pregunta: "¿Puedo entregar un documento después de la fecha límite?",
    respuesta: "Debes cumplir las fechas establecidas. Si tienes una situación que te impide hacerlo, comunícala oportunamente por los canales institucionales para recibir orientación.",
  },
  {
    numero: 109, categoria: 'fechas_y_cronograma',
    pregunta: "¿Qué pasa si dejo todo para el último día?",
    respuesta: "No es recomendable. Si encuentras un error en un documento, una falla en el sistema o una corrección pendiente, tendrás menos tiempo para solucionarlo antes del cierre del proceso.",
  },
  {
    numero: 110, categoria: 'tickets_y_seguimiento_de_solicitudes',
    pregunta: "¿Por qué fue cerrado mi ticket sin recibir una respuesta directa en la misma solicitud?",
    respuesta: "Cuando se genera más de un requerimiento sobre el mismo tema, el sistema unifica el trámite para mantener la trazabilidad. Si su caso fue cerrado por duplicidad, la respuesta oficial fue emitida en el radicado inicial. Le invitamos a verificar el número de ticket de referencia proporcionado en la notificación.",
  },
  {
    numero: 111, categoria: 'tickets_y_seguimiento_de_solicitudes',
    pregunta: "¿Qué pasa si ya envié un correo preguntando por mi proceso?",
    respuesta: "Si tu solicitud requiere revisión, debes esperar la respuesta correspondiente y evitar enviar múltiples correos con la misma solicitud. Cuando respondas, procura mantener el mismo hilo para conservar el historial del caso.",
  },
  {
    numero: 112, categoria: 'tickets_y_seguimiento_de_solicitudes',
    pregunta: "¿A quién debo acudir si tengo una duda sobre mi práctica?",
    respuesta: "Debes utilizar los canales institucionales definidos para la atención de prácticas. Antes de realizar una solicitud, ten a la mano tu información y explica claramente el inconveniente para facilitar la orientación.",
  },
  {
    numero: 113, categoria: 'apoyo_laboral',
    pregunta: "¿Qué es Apoyo Laboral?",
    respuesta: "Es el área de la CUN que acompaña a estudiantes y egresados en el fortalecimiento de sus competencias para la empleabilidad y facilita su conexión con oportunidades laborales y empresas.",
  },
  {
    numero: 114, categoria: 'apoyo_laboral',
    pregunta: "¿Apoyo Laboral garantiza la consecución de un empleo?",
    respuesta: "Apoyo Laboral facilita herramientas, orientación y oportunidades para fortalecer el proceso de empleabilidad;\nsin embargo, la vinculación laboral depende mayoritariamente de una gestión autónoma y de los procesos de selección establecidos por cada empresa.",
  },
  {
    numero: 115, categoria: 'apoyo_laboral',
    pregunta: "¿Qué es la Ruta de Empleabilidad?",
    respuesta: "Es un conjunto de servicios y estrategias diseñados para acompañar a estudiantes y graduados en las diferentes etapas de su proceso de empleabilidad, desde el autoconocimiento y la preparación profesional hasta la búsqueda de oportunidades laborales.",
  },
  {
    numero: 116, categoria: 'apoyo_laboral',
    pregunta: "¿Qué servicios ofrece la Ruta de Empleabilidad?",
    respuesta: "La Ruta cuenta con diferentes servicios de acompañamiento, entre ellos orientación para la elaboración de hoja de vida, orientación para procesos de selección, assessments de entrevista, talleres y espacios de formación en empleabilidad, además de acceso a oportunidades laborales a través del Banco de Hojas de Vida.",
  },
  {
    numero: 117, categoria: 'apoyo_laboral',
    pregunta: "¿Qué es el Banco de Hojas de Vida?",
    respuesta: "Es una herramienta de Apoyo Laboral que permite recopilar y organizar la información de practicantes interesados en oportunidades de práctica o pasantía, con el propósito de facilitar la gestión de sus perfiles ante empresas de su interés.",
  },
  {
    numero: 118, categoria: 'apoyo_laboral',
    pregunta: "¿Cómo solicitar que la hoja de vida sea enviada a una oferta?",
    respuesta: "Primero se deben revisar las ofertas disponibles y seleccionar aquellas que sean acordes con el perfil.\nPosteriormente, diligenciar el formulario del Banco de Hojas de Vida, registrar las empresas de interés y cargar la hoja de vida para que Apoyo Laboral pueda realizar la gestión correspondiente.",
  },
  {
    numero: 119, categoria: 'apoyo_laboral',
    pregunta: "¿Dónde consultar las ofertas laborales disponibles?",
    respuesta: "Las oportunidades laborales se encuentran disponibles en las carpetas de Drive dispuestas por Apoyo Laboral, donde se publican piezas gráficas con la información y los requisitos de las diferentes ofertas.",
  },
  {
    numero: 120, categoria: 'apoyo_laboral',
    pregunta: "¿Qué se debe tener en cuenta antes de registrar la hoja de vida?",
    respuesta: "Se recomienda haber culminado los servicios correspondientes de la Ruta de Empleabilidad, especialmente aquellos relacionados con la construcción y revisión de la hoja de vida. Esto permite contar con un documento actualizado, estructurado y adecuado para procesos de selección y sistemas ATS.",
  },
  {
    numero: 121, categoria: 'convenios',
    pregunta: "¿Es indispensable que la CUN tenga un convenio previo con la empresa donde realizaré mis prácticas?",
    respuesta: "Sí, es necesario que exista un convenio entre la CUN y la empresa, excepto cuando la práctica se realiza bajo la modalidad de contrato de aprendizaje. En esta modalidad, el convenio no es obligatorio; se requiere la firma del contrato. Si la empresa desea suscribir adicionalmente un convenio, también puede hacerlo.\nSi no existe convenio, el área de Desarrollo Profesional se encarga de gestionar la alianza. La Bolsa de Empleo CUN cuenta con organizaciones aliadas externas para el desarrollo de prácticas. Si deseas postular un centro de prácticas, puedes indicarle a la organización que contacte a desarrollo_profesional@cun.edu.co para revisar sus necesidades y solicitar los documentos pertinentes para formalizar el convenio.",
  },
  {
    numero: 122, categoria: 'convenios',
    pregunta: "¿Qué modalidades de convenio existen para la realización de prácticas?",
    respuesta: "Convenio Interinstitucional de largo plazo: Es un acuerdo marco formalizado entre la CUN y la empresa con una vigencia de dos años o más. Durante este período, la organización puede vincular al número de practicantes o pasantes que requiera.\nAcuerdo Tripartito individual: Es un compromiso suscrito entre tres partes: la CUN, la empresa y el estudiante.\nSu vigencia se limita exclusivamente a la duración de la práctica de ese estudiante en particular.\nNota: Si la organización necesita mayor información sobre estos trámites, puede comunicarse al correo desarrollo_profesional@cun.edu.co.\n123. Si la empresa que postulé como centro de prácticas solicita contacto o la firma de documentos por parte de la CUN, ¿a quién debo dirigirme? Categoría: Convenios Debes remitir los datos de la persona encargada en la empresa (nombre, número de contacto y correo electrónico) a desarrollo_profesional@cun.edu.co. Desde la coordinación de Desarrollo Profesional nos pondremos en contacto directo con la organización para formalizar el proceso.",
  },
  {
    numero: 123, categoria: 'convenios',
    pregunta: "Si la empresa que postulé como centro de prácticas solicita contacto o la firma de documentos por parte de la CUN, ¿a quién debo dirigirme?",
    respuesta: "Debes remitir los datos de la persona encargada en la empresa (nombre, número de contacto y correo electrónico) a desarrollo_profesional@cun.edu.co. Desde la coordinación de Desarrollo Profesional nos pondremos en contacto directo con la organización para formalizar el proceso.",
  },
];

/** Búsqueda sencilla, sin acentos ni mayúsculas, sobre pregunta y respuesta. */
export function buscarPreguntas(texto: string, categoria?: CategoriaPqrs): PreguntaFrecuente[] {
  const normal = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const terminos = normal(texto).split(/\s+/).filter((t) => t.length > 2);
  return PREGUNTAS_FRECUENTES.filter((p) => {
    if (categoria && p.categoria !== categoria) return false;
    if (terminos.length === 0) return true;
    const cuerpo = normal(`${p.pregunta} ${p.respuesta}`);
    return terminos.every((t) => cuerpo.includes(t));
  });
}
