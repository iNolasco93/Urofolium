const STRUCTURED_DETAIL_PREFIX = 'urofolium-detail-v1:';
const PEYRONIE_PROCEDURE = 'Cirugía de Peyronie';
const PEYRONIE_WITH_PROSTHESIS = 'Cirugía de Peyronie + Prótesis';
const LEGACY_PEYRONIE_PROCEDURE = 'Peyronie';
const LEGACY_PEYRONIE_WITH_PROSTHESIS = 'Peyronie + Prótesis';

export interface ProcedureDetails {
  tipoDerivacionUrinaria: string;
  tecnica: string;
  tipoProtesis: string;
}

export interface ProcedureWorkbookFields extends ProcedureDetails {
  procedimientoBase: string;
  procedimientoFinal: string;
}

const TECHNIQUE_PROCEDURES = new Set([
  LEGACY_PEYRONIE_PROCEDURE, PEYRONIE_PROCEDURE, 'Biopsia testicular', 'Fístula vesico-vaginal',
]);
const STRUCTURED_PROCEDURES = new Set([
  'Cistectomía radical', LEGACY_PEYRONIE_PROCEDURE, PEYRONIE_PROCEDURE,
  LEGACY_PEYRONIE_WITH_PROSTHESIS, PEYRONIE_WITH_PROSTHESIS,
  'Prótesis de pene', 'Biopsia testicular', 'Fístula vesico-vaginal',
]);
const TRAUMA_PROCEDURES = new Set(['Trauma vesical', 'Trauma renal', 'Trauma ureteral']);

function isPeyronieWithProsthesis(procedure: string): boolean {
  return procedure === PEYRONIE_WITH_PROSTHESIS || procedure === LEGACY_PEYRONIE_WITH_PROSTHESIS;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function decodeProcedureDetails(procedimiento: string, storedDetail: string | null | undefined): ProcedureDetails {
  const detail = clean(storedDetail);
  const empty = { tipoDerivacionUrinaria: '', tecnica: '', tipoProtesis: '' };
  if (!detail) return empty;

  if (procedimiento === 'Cistectomía radical') {
    return {
      ...empty,
      tipoDerivacionUrinaria: detail.startsWith('Otra: ') ? detail.slice(6).trim() : detail,
    };
  }

  if (isPeyronieWithProsthesis(procedimiento)) {
    if (detail.startsWith(STRUCTURED_DETAIL_PREFIX)) {
      try {
        const parsed = JSON.parse(detail.slice(STRUCTURED_DETAIL_PREFIX.length)) as Record<string, unknown>;
        return { ...empty, tecnica: clean(parsed.tecnica), tipoProtesis: clean(parsed.tipoProtesis) };
      } catch {
        return { ...empty, tecnica: detail };
      }
    }
    return { ...empty, tecnica: detail };
  }

  if (procedimiento === 'Prótesis de pene') return { ...empty, tipoProtesis: detail };
  if (TECHNIQUE_PROCEDURES.has(procedimiento)) return { ...empty, tecnica: detail };
  return empty;
}

export function encodeProcedureDetails(procedimiento: string, details: Partial<ProcedureDetails>): string | null {
  const tipoDerivacionUrinaria = clean(details.tipoDerivacionUrinaria);
  const tecnica = clean(details.tecnica);
  const tipoProtesis = clean(details.tipoProtesis);

  if (procedimiento === 'Cistectomía radical') return tipoDerivacionUrinaria || null;
  if (isPeyronieWithProsthesis(procedimiento)) {
    if (!tecnica && !tipoProtesis) return null;
    return `${STRUCTURED_DETAIL_PREFIX}${JSON.stringify({ tecnica, tipoProtesis })}`;
  }
  if (procedimiento === 'Prótesis de pene') return tipoProtesis || null;
  if (TECHNIQUE_PROCEDURES.has(procedimiento)) return tecnica || null;
  return null;
}

export function usesStructuredProcedureDetails(procedimiento: string): boolean {
  return STRUCTURED_PROCEDURES.has(procedimiento);
}

export function getProcedureWorkbookFields(procedimiento: string, storedDetail: string | null | undefined): ProcedureWorkbookFields {
  const details = decodeProcedureDetails(procedimiento, storedDetail);
  const freeTextDetail = clean(storedDetail);
  const { tipoDerivacionUrinaria, tecnica, tipoProtesis } = details;
  const procedimientoBase = procedimiento === LEGACY_PEYRONIE_PROCEDURE
    ? PEYRONIE_PROCEDURE
    : procedimiento === LEGACY_PEYRONIE_WITH_PROSTHESIS
      ? PEYRONIE_WITH_PROSTHESIS
      : procedimiento;
  let procedimientoFinal = procedimientoBase;

  if (procedimientoBase === 'Cistectomía radical' && tipoDerivacionUrinaria) {
    procedimientoFinal = `${procedimientoBase} + ${tipoDerivacionUrinaria}`;
  } else if (procedimientoBase === PEYRONIE_PROCEDURE) {
    procedimientoFinal = tecnica ? `${PEYRONIE_PROCEDURE} + ${tecnica}` : PEYRONIE_PROCEDURE;
  } else if (procedimientoBase === PEYRONIE_WITH_PROSTHESIS) {
    procedimientoFinal = tecnica ? `${PEYRONIE_PROCEDURE} tipo ${tecnica} + Prótesis` : procedimientoBase;
    if (tipoProtesis) procedimientoFinal += ` ${tipoProtesis}`;
  } else if (procedimientoBase === 'Prótesis de pene' && tipoProtesis) {
    procedimientoFinal = `${procedimientoBase} ${tipoProtesis}`;
  } else if (procedimientoBase === 'Biopsia testicular' && tecnica) {
    procedimientoFinal = `${procedimientoBase} ${tecnica}`;
  } else if (procedimientoBase === 'Fístula vesico-vaginal' && tecnica) {
    procedimientoFinal = `${procedimientoBase} + ${tecnica}`;
  } else if (TRAUMA_PROCEDURES.has(procedimientoBase) && freeTextDetail) {
    procedimientoFinal = `${procedimientoBase}: ${freeTextDetail}`;
  }

  return { procedimientoBase, procedimientoFinal, ...details };
}

function inferWorkbookFields(procedimientoFinal: string): ProcedureWorkbookFields {
  const display = clean(procedimientoFinal);
  const empty = { tipoDerivacionUrinaria: '', tecnica: '', tipoProtesis: '' };

  for (const traumaProcedure of TRAUMA_PROCEDURES) {
    const prefix = `${traumaProcedure}:`;
    if (display.startsWith(prefix)) {
      return {
        procedimientoBase: traumaProcedure,
        procedimientoFinal: display,
        ...empty,
        tecnica: display.slice(prefix.length).trim(),
      };
    }
  }

  if (display.startsWith('Cistectomía radical + ')) {
    return {
      procedimientoBase: 'Cistectomía radical', procedimientoFinal: display,
      ...empty, tipoDerivacionUrinaria: display.slice('Cistectomía radical + '.length).trim(),
    };
  }
  if (display.startsWith('Fístula vesico-vaginal + ')) {
    return {
      procedimientoBase: 'Fístula vesico-vaginal', procedimientoFinal: display,
      ...empty, tecnica: display.slice('Fístula vesico-vaginal + '.length).trim(),
    };
  }
  if (display.startsWith('Biopsia testicular ')) {
    return {
      procedimientoBase: 'Biopsia testicular', procedimientoFinal: display,
      ...empty, tecnica: display.slice('Biopsia testicular '.length).trim(),
    };
  }
  if (display.startsWith('Prótesis de pene ')) {
    return {
      procedimientoBase: 'Prótesis de pene', procedimientoFinal: display,
      ...empty, tipoProtesis: display.slice('Prótesis de pene '.length).trim(),
    };
  }
  if (display.startsWith(`${PEYRONIE_WITH_PROSTHESIS} `)) {
    return {
      procedimientoBase: PEYRONIE_WITH_PROSTHESIS, procedimientoFinal: display,
      ...empty, tipoProtesis: display.slice(`${PEYRONIE_WITH_PROSTHESIS} `.length).trim(),
    };
  }
  if (display.startsWith(`${LEGACY_PEYRONIE_WITH_PROSTHESIS} `)) {
    return {
      procedimientoBase: PEYRONIE_WITH_PROSTHESIS, procedimientoFinal: display,
      ...empty, tipoProtesis: display.slice(`${LEGACY_PEYRONIE_WITH_PROSTHESIS} `.length).trim(),
    };
  }
  if (display.startsWith(`${LEGACY_PEYRONIE_PROCEDURE} + `) && !display.includes(' + Prótesis')) {
    return {
      procedimientoBase: PEYRONIE_PROCEDURE, procedimientoFinal: display,
      ...empty, tecnica: display.slice(`${LEGACY_PEYRONIE_PROCEDURE} + `.length).trim(),
    };
  }
  if (display.startsWith(`${PEYRONIE_PROCEDURE} + `)) {
    return {
      procedimientoBase: PEYRONIE_PROCEDURE, procedimientoFinal: display,
      ...empty, tecnica: display.slice(`${PEYRONIE_PROCEDURE} + `.length).trim(),
    };
  }
  const typedPrefix = display.startsWith(`${PEYRONIE_PROCEDURE} tipo `)
    ? `${PEYRONIE_PROCEDURE} tipo `
    : display.startsWith(`${LEGACY_PEYRONIE_PROCEDURE} tipo `)
      ? `${LEGACY_PEYRONIE_PROCEDURE} tipo `
      : '';
  if (typedPrefix) {
    const remainder = display.slice(typedPrefix.length);
    const separator = ' + Prótesis';
    const separatorIndex = remainder.indexOf(separator);
    if (separatorIndex >= 0) {
      return {
        procedimientoBase: PEYRONIE_WITH_PROSTHESIS, procedimientoFinal: display,
        ...empty,
        tecnica: remainder.slice(0, separatorIndex).trim(),
        tipoProtesis: remainder.slice(separatorIndex + separator.length).trim(),
      };
    }
    return { procedimientoBase: PEYRONIE_PROCEDURE, procedimientoFinal: display, ...empty, tecnica: remainder.trim() };
  }

  return { procedimientoBase: display, procedimientoFinal: display, ...empty };
}

export function parseProcedureWorkbookFields(
  procedimientoFinal: unknown,
  procedimientoBase: unknown,
  tipoDerivacionUrinaria: unknown,
  tecnica: unknown,
  tipoProtesis: unknown,
): { procedimiento: string; storedDetail: string | null } {
  const inferred = inferWorkbookFields(clean(procedimientoFinal));
  const base = clean(procedimientoBase) || inferred.procedimientoBase;
  const details = {
    tipoDerivacionUrinaria: clean(tipoDerivacionUrinaria) || inferred.tipoDerivacionUrinaria,
    tecnica: clean(tecnica) || inferred.tecnica,
    tipoProtesis: clean(tipoProtesis) || inferred.tipoProtesis,
  };
  return {
    procedimiento: base,
    storedDetail: TRAUMA_PROCEDURES.has(base)
      ? details.tecnica || null
      : encodeProcedureDetails(base, details),
  };
}
