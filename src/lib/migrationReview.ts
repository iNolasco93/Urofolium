import type { Procedure } from './types';
import { decodeProcedureDetails } from './procedureDetails';
import { CATEGORIAS, getAbordajeFijo } from './categorias';

export interface MigrationReviewCase {
  id: string;
  fecha: string;
  categoriaActual: string;
  procedimientoActual: string;
  abordajeActual: string;
  problemas: string[];
  categoriaSugerida: string;
  procedimientoSugerido: string;
  abordajeSugerido: string;
  accionRequerida: string;
}

const LEGACY_CATEGORIES = new Set([
  'Endourología',
  'Cirugía renal y ureteral',
  'Cirugía pélvica y prostática mayor',
  'Genital masculina',
  'Suelo pélvico / continencia',
]);

const PROCEDURE_ALIASES: Record<string, string> = {
  Botox: 'Botox intravesical',
  'Colporrafia anterior': 'Reparación cistocele',
  'Esfínter artificial': 'Implante de esfínter artificial',
  'Adenomectomía suprapúbica': 'Adenomectomía',
  Peyronie: 'Cirugía de Peyronie',
  'Peyronie + Prótesis': 'Cirugía de Peyronie + Prótesis',
  'Orquiectomía simple / escrotal': 'Orquiectomía simple',
  'Orquiectomía simple/escrotal': 'Orquiectomía simple',
  'Orquiectomía inguinal + prótesis': 'Orquiectomía inguinal con prótesis',
};

const LEGACY_CATEGORY_BY_PROCEDURE: Record<string, string> = {
  'RTU vesical': 'Patología vesical',
  BVM: 'Patología vesical',
  'RTU prostática': 'Patología prostática',
  'RTU cuello': 'Patología prostática',
  'Uretrotomía interna': 'Patología uretral',
  'Botox intravesical': 'Patología uroginecológica',
  'Nefrectomía radical': 'Patología renal',
  Nefroureterectomía: 'Patología renal',
  'Nefrectomía parcial': 'Patología renal',
  'Tumorectomía renal': 'Patología renal',
  Pieloplastia: 'Patología ureteral',
  'Pielo/ureterolitotomía': 'Patología ureteral',
  'Prostatectomía radical': 'Patología prostática',
  Adenomectomía: 'Patología prostática',
  'Cistectomía radical': 'Patología vesical',
  Fournier: 'Cirugía de urgencia',
  Circuncisión: 'Patología peneana',
  Frenuloplastia: 'Patología peneana',
  Meatotomía: 'Patología peneana',
  'Penectomía parcial': 'Patología peneana',
  'Penectomía total': 'Patología peneana',
  'Cirugía de Peyronie': 'Patología peneana',
  'Cirugía de Peyronie + Prótesis': 'Patología peneana',
  Vasectomía: 'Patología testicular y escrotal',
  'Quiste escrotal': 'Patología testicular y escrotal',
  Hidrocelectomía: 'Patología testicular y escrotal',
  Varicocelectomía: 'Patología testicular y escrotal',
  'Exéresis de quiste de epidídimo': 'Patología testicular y escrotal',
  'Lipoma de cordón espermático': 'Patología testicular y escrotal',
  Orquiectomía: 'Patología testicular y escrotal',
  'Orquiectomía simple': 'Patología testicular y escrotal',
  'Orquiectomía inguinal': 'Patología testicular y escrotal',
  'Orquiectomía simple con prótesis': 'Patología testicular y escrotal',
  'Orquiectomía inguinal con prótesis': 'Patología testicular y escrotal',
  Orquidopexia: 'Patología testicular y escrotal',
  'Prótesis testicular': 'Patología testicular y escrotal',
  TOT: 'Patología uroginecológica',
  'Reparación cistocele': 'Patología uroginecológica',
  'Carúncula uretral': 'Patología uroginecológica',
  'Implante de esfínter artificial': 'Patología uretral',
};

function normalizeCatalogKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const PROCEDURE_ALIASES_BY_KEY = new Map(
  Object.entries(PROCEDURE_ALIASES).map(([source, target]) => [normalizeCatalogKey(source), target]),
);
const KNOWN_PROCEDURES_BY_KEY = new Map(
  [...Object.values(CATEGORIAS).flat(), ...Object.keys(LEGACY_CATEGORY_BY_PROCEDURE)]
    .map(procedure => [normalizeCatalogKey(procedure), procedure]),
);
const CURRENT_CATEGORIES_BY_KEY = new Map(
  Object.keys(CATEGORIAS).map(category => [normalizeCatalogKey(category), category]),
);
const LEGACY_CATEGORY_KEYS = new Set([...LEGACY_CATEGORIES].map(normalizeCatalogKey));
const APPROACHES_BY_KEY = new Map([
  'Abierto', 'Endoscópico', 'Percutáneo', 'Laparoscópico', 'Robótico',
  'Retroperitoneal', 'Microcirugía', 'Vaginal', 'Transvaginal',
].map(approach => [normalizeCatalogKey(approach), approach]));

function canonicalProcedure(procedure: string): string {
  return PROCEDURE_ALIASES[procedure]
    ?? PROCEDURE_ALIASES_BY_KEY.get(normalizeCatalogKey(procedure))
    ?? KNOWN_PROCEDURES_BY_KEY.get(normalizeCatalogKey(procedure))
    ?? procedure;
}

function canonicalCategory(category: string): string {
  return CURRENT_CATEGORIES_BY_KEY.get(normalizeCatalogKey(category)) ?? category;
}

function isLegacyCategory(category: string): boolean {
  return LEGACY_CATEGORY_KEYS.has(normalizeCatalogKey(category));
}

function canonicalApproach(approach: string): string {
  return APPROACHES_BY_KEY.get(normalizeCatalogKey(approach)) ?? approach;
}

function isOtherProcedure(procedure: string): boolean {
  return procedure === 'Otros' || procedure.startsWith('Otros:');
}

export function migrateProcedureCatalog(procedure: Procedure, now = new Date().toISOString()): Procedure {
  const procedimiento = canonicalProcedure(procedure.procedimiento);
  let categoria = canonicalCategory(procedure.categoria);

  if (isLegacyCategory(categoria) && !isOtherProcedure(procedimiento)) {
    categoria = LEGACY_CATEGORY_BY_PROCEDURE[procedimiento] ?? categoria;
  }

  const fixedApproach = getAbordajeFijo(categoria, procedimiento);
  const canonicalLegacyApproach = canonicalApproach(procedure.abordaje);
  const legacyApproach = canonicalLegacyApproach === 'Transvaginal' ? 'Vaginal' : canonicalLegacyApproach;
  const legacyForcedApproach = normalizeCatalogKey(procedure.procedimiento) === normalizeCatalogKey('Adenomectomía suprapúbica')
    ? 'Abierto'
    : null;
  const abordaje = legacyForcedApproach ?? fixedApproach ?? legacyApproach;
  if (
    categoria === procedure.categoria
    && procedimiento === procedure.procedimiento
    && abordaje === procedure.abordaje
  ) {
    return procedure;
  }

  return { ...procedure, categoria, procedimiento, abordaje, updated_at: now };
}

export function getAutomaticCatalogMigrationUpdates(
  procedures: Procedure[], now = new Date().toISOString(),
): Procedure[] {
  return procedures
    .map(procedure => migrateProcedureCatalog(procedure, now))
    .filter((procedure, index) => procedure !== procedures[index]);
}

export function getMigrationReviewCases(procedures: Procedure[]): MigrationReviewCase[] {
  return procedures.flatMap(procedure => {
    const problemas: string[] = [];
    const migrated = migrateProcedureCatalog(procedure, procedure.updated_at);
    const canonical = migrated.procedimiento;
    let categoriaSugerida = migrated.categoria;
    let procedimientoSugerido = migrated.procedimiento;
    let abordajeSugerido = migrated.abordaje;
    const acciones: string[] = [];

    if (isLegacyCategory(migrated.categoria)) {
      problemas.push(isOtherProcedure(migrated.procedimiento)
        ? 'La categoría anterior se dividió y “Otros” no se puede clasificar automáticamente.'
        : 'La categoría anterior no tiene una correspondencia automática.');
      categoriaSugerida = '';
      acciones.push('Seleccionar la categoría correcta.');
    }

    if (canonical === 'Cistectomía radical') {
      const details = decodeProcedureDetails('Cistectomía radical', procedure.otro_especificar);
      if (!details.tipoDerivacionUrinaria) {
        problemas.push('Falta el tipo de derivación urinaria.');
        acciones.push('Seleccionar la derivación urinaria.');
      }
    }

    if (migrated.procedimiento === 'HoLEP/ThuLEP') {
      problemas.push('No se especificó si la técnica fue HoLEP o ThuLEP.');
      procedimientoSugerido = '';
      acciones.push('Seleccionar HoLEP o ThuLEP.');
    }

    if (canonical === 'Biopsia testicular') {
      const details = decodeProcedureDetails('Biopsia testicular', migrated.otro_especificar);
      if (!details.tecnica) {
        problemas.push('Falta la técnica de biopsia testicular.');
        acciones.push('Seleccionar TESE, MicroTESE o TESA.');
      } else {
        const expectedApproach = details.tecnica === 'TESA'
          ? 'Percutáneo'
          : ['TESE', 'MicroTESE'].includes(details.tecnica) ? 'Abierto' : '';
        if (expectedApproach && migrated.abordaje !== expectedApproach) {
          problemas.push(`El abordaje no corresponde a la técnica ${details.tecnica}.`);
          abordajeSugerido = expectedApproach;
          acciones.push(`Confirmar el abordaje ${expectedApproach}.`);
        }
      }
    }

    if (problemas.length === 0) return [];
    return [{
      id: procedure.id,
      fecha: String(procedure.fecha).slice(0, 10),
      categoriaActual: procedure.categoria,
      procedimientoActual: procedure.procedimiento,
      abordajeActual: procedure.abordaje,
      problemas,
      categoriaSugerida,
      procedimientoSugerido,
      abordajeSugerido,
      accionRequerida: [...new Set(acciones)].join(' '),
    }];
  });
}
