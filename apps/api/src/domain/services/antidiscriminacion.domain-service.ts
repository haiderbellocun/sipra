/**
 * Filtro antidiscriminación de vacantes (M7 / Ley 931 de 2004 y concordantes).
 * Es un BLOQUEO, no una advertencia. Determinístico: sin IA.
 */
export interface HallazgoDiscriminatorio {
  categoria: 'edad' | 'sexo' | 'fotografia' | 'raza' | 'religion' | 'origen' | 'estado_civil' | 'apariencia';
  fragmento: string;
  norma: string;
}

interface ReglaAntidiscriminacion {
  categoria: HallazgoDiscriminatorio['categoria'];
  norma: string;
  patrones: RegExp[];
}

const REGLAS: readonly ReglaAntidiscriminacion[] = [
  {
    categoria: 'edad',
    norma: 'Ley 931 de 2004',
    patrones: [
      /\b(?:entre\s+)?\d{2}\s*(?:y|a|-)\s*\d{2}\s*a[nñ]os\b/i,
      /\b(?:menor|mayor)\s+de\s+\d{2}\s*a[nñ]os\b/i,
      /\bedad\s*(?:m[aá]xima|m[ií]nima|requerida|entre)\b/i,
      /\bm[aá]ximo\s+\d{2}\s*a[nñ]os\b/i,
      /\bpersonas?\s+j[oó]venes\b/i,
      /\brango\s+de\s+edad\b/i,
    ],
  },
  {
    categoria: 'sexo',
    norma: 'Ley 1496 de 2011 · Ley 823 de 2003',
    patrones: [
      /\bsolo\s+(?:hombres|mujeres)\b/i,
      /\b[uú]nicamente\s+(?:hombres|mujeres)\b/i,
      /\bpreferiblemente\s+(?:hombre|mujer|masculino|femenino)\b/i,
      /\bsexo\s*:\s*(?:m|f|masculino|femenino)\b/i,
      /\bg[eé]nero\s*:\s*(?:masculino|femenino)\b/i,
      /\bse\s+busca\s+(?:hombre|mujer)\b/i,
    ],
  },
  {
    categoria: 'fotografia',
    norma: 'Resolución 2605 de 2014',
    patrones: [
      /\bfoto(?:graf[ií]a)?\s+(?:reciente|actualizada|de\s+cuerpo\s+entero|tipo\s+documento)\b/i,
      /\badjuntar\s+foto(?:graf[ií]a)?\b/i,
      /\bcon\s+foto(?:graf[ií]a)?\b/i,
      /\benviar\s+foto\b/i,
    ],
  },
  {
    categoria: 'raza',
    norma: 'Ley 1482 de 2011',
    patrones: [/\braza\b/i, /\bcolor\s+de\s+piel\b/i, /\betnia\b/i, /\bafro\b/i, /\bind[ií]gena\b/i],
  },
  {
    categoria: 'religion',
    norma: 'Constitución Política, art. 19',
    patrones: [/\breligi[oó]n\b/i, /\bcredo\b/i, /\bcat[oó]lic[oa]\b/i, /\bcristian[oa]\b/i],
  },
  {
    categoria: 'origen',
    norma: 'Constitución Política, art. 13',
    patrones: [
      /\bnacionalidad\s*:\s*\w+/i,
      /\bsolo\s+colombianos\b/i,
      /\bno\s+extranjeros\b/i,
      /\blugar\s+de\s+nacimiento\b/i,
    ],
  },
  {
    categoria: 'estado_civil',
    norma: 'Constitución Política, art. 13',
    patrones: [
      /\bestado\s+civil\s*:/i,
      /\bsin\s+hijos\b/i,
      /\bsolter[oa]s?\b/i,
      /\bno\s+(?:estar\s+)?embarazada\b/i,
    ],
  },
  {
    categoria: 'apariencia',
    norma: 'Constitución Política, art. 13',
    patrones: [
      /\bbuena\s+presencia\b/i,
      /\bexcelente\s+presentaci[oó]n\s+personal\s+y\s+f[ií]sica\b/i,
      /\bestatura\s+m[ií]nima\b/i,
      /\bsin\s+tatuajes\b/i,
    ],
  },
];

export class AntidiscriminacionDomainService {
  /** Analiza todo el texto publicable de la vacante. */
  analizar(...textos: (string | null | undefined)[]): HallazgoDiscriminatorio[] {
    const texto = textos.filter(Boolean).join('\n');
    if (!texto.trim()) return [];

    const hallazgos: HallazgoDiscriminatorio[] = [];
    for (const regla of REGLAS) {
      for (const patron of regla.patrones) {
        const coincidencia = texto.match(patron);
        if (coincidencia) {
          hallazgos.push({
            categoria: regla.categoria,
            fragmento: coincidencia[0].trim(),
            norma: regla.norma,
          });
          break; // una coincidencia por categoría basta para bloquear
        }
      }
    }
    return hallazgos;
  }

  esPublicable(...textos: (string | null | undefined)[]): boolean {
    return this.analizar(...textos).length === 0;
  }
}
