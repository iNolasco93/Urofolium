export const SELECTABLE = '__SELECTABLE__';
export const PATOLOGIA_PROSTATICA = 'Patología prostática';
export const PROCEDIMIENTOS_HBP = [
  'RTU prostática', 'HoLEP/ThuLEP', 'Láser verde', 'Adenomectomía',
  'Aquabeam', 'Rezum', 'Urolift', 'Optilume',
] as const;
export const PROCEDIMIENTOS_HBP_GUARDADOS = [
  'RTU prostática', 'HoLEP', 'ThuLEP', 'Láser verde', 'Adenomectomía',
  'Aquabeam', 'Rezum', 'Urolift', 'Optilume',
] as const;
export const OTROS_PROCEDIMIENTOS_PROSTATICOS = [
  'RTU cuello', 'Prostatectomía radical', 'Otros',
] as const;
export const PROCEDIMIENTOS_ORQUIECTOMIA = [
  'Orquiectomía simple', 'Orquiectomía inguinal',
  'Orquiectomía simple con prótesis', 'Orquiectomía inguinal con prótesis',
] as const;

export const CATEGORIAS: Record<string, string[]> = {
  'Cirugía de urgencia': [
    'Fournier', 'Trauma vesical', 'Trauma renal', 'Trauma ureteral',
    'Evacuación de coágulo molde', 'Otros',
  ],
  'Litiasis': [
    'NLPC', 'ECIRS', 'URS', 'RIRS',
    'Cistolitotricia', 'Cistolitotomía', 'Otros',
  ],
  'Derivaciones urinarias': [
    'Colocación JJ', 'Nefrostomía', 'Talla vesical', 'Otros',
  ],
  [PATOLOGIA_PROSTATICA]: [
    ...PROCEDIMIENTOS_HBP, ...OTROS_PROCEDIMIENTOS_PROSTATICOS,
  ],
  'Patología vesical': [
    'RTU vesical', 'BVM', 'Cistectomía parcial', 'Cistectomía radical',
    'Cistoplastia de ampliación', 'Cistostomía suprapúbica',
    'Diverticulectomía vesical', 'Reparación de fístula vesical', 'Otros',
  ],
  'Patología renal': [
    'Nefrectomía radical', 'Nefroureterectomía', 'Nefrectomía parcial',
    'Tumorectomía renal', 'Quistectomía renal', 'Suprarrenalectomía', 'Otros',
  ],
  'Patología ureteral': [
    'Pieloplastia', 'Pielo/ureterolitotomía', 'Reimplante ureteral',
    'Dilatación neumática de uréter', 'URS', 'RIRS', 'Incisión endoscópica de ureterocele',
    'Inyección endoscópica por RVU', 'Otros',
  ],
  'Patología uretral': [
    'Uretrotomía interna', 'RTU valvas de uretra posterior',
    'Uretroplastia', 'Implante de esfínter artificial', 'Otros',
  ],
  'Patología peneana': [
    'Circuncisión', 'Frenuloplastia', 'Meatotomía', 'Cirugía de Peyronie',
    'Prótesis de pene', 'Cirugía de Peyronie + Prótesis', 'Penectomía',
    'Cirugía de priapismo', 'Quistectomía de pene', 'Otros',
  ],
  'Patología testicular y escrotal': [
    'Vasectomía', 'Quiste escrotal', 'Hidrocelectomía', 'Varicocelectomía',
    'Exéresis de quiste de epidídimo', 'Lipoma de cordón espermático',
    'Orquiectomía', 'Orquidopexia',
    'Prótesis testicular', 'Vasovasostomía', 'Biopsia testicular', 'Otros',
  ],
  'Patología uroginecológica': [
    'TOT', 'Reparación cistocele', 'Colposuspensión', 'Colposacropexia',
    'Fístula vesico-vaginal', 'Carúncula uretral',
    'Diverticulectomía uretral', 'Botox intravesical', 'Otros',
  ],
  'Cirugía de trasplante': [
    'Extracción renal', 'Extracción renal donante vivo', 'Implante renal',
    'Trasplantectomía', 'Otros',
  ],
  'Patología linfática': [
    'Linfadenectomía', 'Marsupialización de linfocele',
  ],
};

type ApproachRule = string | readonly string[] | typeof SELECTABLE;

const OPEN_LAP_ROBOT = ['Abierto', 'Laparoscópico', 'Robótico'] as const;
const OPEN_LAP_ROBOT_RETRO = ['Abierto', 'Laparoscópico', 'Robótico', 'Retroperitoneal'] as const;
const GENERAL_APPROACHES = ['Abierto', 'Endoscópico', 'Percutáneo', 'Laparoscópico', 'Robótico'] as const;
const CATEGORIES_WITHOUT_VAGINAL_APPROACH = new Set([
  PATOLOGIA_PROSTATICA, 'Patología renal', 'Patología ureteral',
  'Patología peneana', 'Patología testicular y escrotal',
  'Cirugía de trasplante', 'Patología linfática',
]);

export const REGLAS_ABORDAJE: Record<string, Record<string, ApproachRule>> = {
  'Cirugía de urgencia': {
    'Fournier': 'Abierto',
    'Trauma vesical': 'Abierto',
    'Trauma renal': 'Abierto',
    'Trauma ureteral': 'Abierto',
    'Evacuación de coágulo molde': ['Endoscópico', 'Abierto'],
    'Otros': ['Abierto', 'Laparoscópico', 'Robótico', 'Endoscópico'],
  },
  'Litiasis': {
    'NLPC': 'Percutáneo', 'ECIRS': 'Percutáneo',
    'URS': 'Endoscópico', 'RIRS': 'Endoscópico',
    'Cistolitotricia': 'Endoscópico', 'Cistolitotomía': 'Abierto',
    'Otros': SELECTABLE,
  },
  'Derivaciones urinarias': {
    'Colocación JJ': 'Endoscópico',
    'Nefrostomía': 'Percutáneo',
    'Talla vesical': 'Percutáneo',
    'Otros': SELECTABLE,
  },
  [PATOLOGIA_PROSTATICA]: {
    'RTU prostática': 'Endoscópico',
    'HoLEP/ThuLEP': 'Endoscópico',
    'HoLEP': 'Endoscópico',
    'ThuLEP': 'Endoscópico',
    'Láser verde': 'Endoscópico',
    'Aquabeam': 'Endoscópico',
    'Rezum': 'Endoscópico',
    'Urolift': 'Endoscópico',
    'Optilume': 'Endoscópico',
    'RTU cuello': 'Endoscópico',
    'Adenomectomía': OPEN_LAP_ROBOT,
    'Prostatectomía radical': OPEN_LAP_ROBOT,
    'Otros': GENERAL_APPROACHES,
  },
  'Patología vesical': {
    'RTU vesical': 'Endoscópico',
    'BVM': 'Endoscópico',
    'Cistectomía parcial': OPEN_LAP_ROBOT,
    'Cistectomía radical': OPEN_LAP_ROBOT,
    'Cistoplastia de ampliación': OPEN_LAP_ROBOT,
    'Cistostomía suprapúbica': 'Abierto',
    'Diverticulectomía vesical': OPEN_LAP_ROBOT,
    'Reparación de fístula vesical': OPEN_LAP_ROBOT,
    'Otros': SELECTABLE,
  },
  'Patología renal': {
    'Nefrectomía radical': OPEN_LAP_ROBOT_RETRO,
    'Nefroureterectomía': OPEN_LAP_ROBOT,
    'Nefrectomía parcial': OPEN_LAP_ROBOT_RETRO,
    'Tumorectomía renal': OPEN_LAP_ROBOT_RETRO,
    'Quistectomía renal': OPEN_LAP_ROBOT_RETRO,
    'Suprarrenalectomía': OPEN_LAP_ROBOT,
    'Otros': SELECTABLE,
  },
  'Patología ureteral': {
    'Pieloplastia': OPEN_LAP_ROBOT_RETRO,
    'Pielo/ureterolitotomía': OPEN_LAP_ROBOT,
    'Reimplante ureteral': OPEN_LAP_ROBOT,
    'Dilatación neumática de uréter': 'Endoscópico',
    'URS': 'Endoscópico', 'RIRS': 'Endoscópico',
    'Incisión endoscópica de ureterocele': 'Endoscópico',
    'Inyección endoscópica por RVU': 'Endoscópico',
    'Otros': SELECTABLE,
  },
  'Patología uretral': {
    'Uretrotomía interna': 'Endoscópico',
    'RTU valvas de uretra posterior': 'Endoscópico',
    'Uretroplastia': 'Abierto',
    'Implante de esfínter artificial': 'Abierto',
    'Otros': SELECTABLE,
  },
  'Patología peneana': {
    'Circuncisión': 'Abierto', 'Frenuloplastia': 'Abierto',
    'Meatotomía': 'Abierto', 'Cirugía de Peyronie': 'Abierto',
    'Peyronie': 'Abierto',
    'Prótesis de pene': 'Abierto',
    'Cirugía de Peyronie + Prótesis': 'Abierto', 'Peyronie + Prótesis': 'Abierto',
    'Penectomía': 'Abierto', 'Penectomía parcial': 'Abierto', 'Penectomía total': 'Abierto',
    'Cirugía de priapismo': 'Abierto',
    'Quistectomía de pene': 'Abierto', 'Otros': 'Abierto',
  },
  'Patología testicular y escrotal': {
    'Vasectomía': 'Abierto', 'Quiste escrotal': 'Abierto',
    'Hidrocelectomía': 'Abierto', 'Varicocelectomía': 'Abierto',
    'Exéresis de quiste de epidídimo': 'Abierto',
    'Lipoma de cordón espermático': 'Abierto',
    'Orquiectomía': 'Abierto',
    'Orquiectomía simple': 'Abierto',
    'Orquiectomía simple con prótesis': 'Abierto',
    'Orquiectomía inguinal': 'Abierto',
    'Orquiectomía inguinal con prótesis': 'Abierto',
    'Orquidopexia': 'Abierto', 'Prótesis testicular': 'Abierto',
    'Vasovasostomía': ['Abierto', 'Microcirugía'],
    'Biopsia testicular': ['Abierto', 'Percutáneo'], 'Otros': 'Abierto',
  },
  'Patología uroginecológica': {
    'TOT': 'Vaginal', 'Reparación cistocele': 'Vaginal',
    'Colposuspensión': ['Abierto', 'Laparoscópico'],
    'Colposacropexia': OPEN_LAP_ROBOT,
    'Fístula vesico-vaginal': ['Abierto', 'Laparoscópico', 'Robótico', 'Vaginal'],
    'Carúncula uretral': 'Vaginal',
    'Diverticulectomía uretral': 'Vaginal',
    'Botox intravesical': 'Endoscópico', 'Otros': SELECTABLE,
  },
  'Cirugía de trasplante': {
    'Extracción renal': 'Abierto',
    'Extracción renal donante vivo': OPEN_LAP_ROBOT,
    'Implante renal': ['Abierto', 'Robótico'],
    'Trasplantectomía': ['Abierto', 'Robótico', 'Laparoscópico'],
    'Otros': SELECTABLE,
  },
  'Patología linfática': {
    'Linfadenectomía': OPEN_LAP_ROBOT,
    'Marsupialización de linfocele': OPEN_LAP_ROBOT,
  },
};

export const ABORDAJES_SELECCIONABLES = ['Abierto', 'Laparoscópico', 'Robótico'];
export const TODOS_ABORDAJES = [...GENERAL_APPROACHES];
const TODOS_ABORDAJES_AMPLIADOS = [
  ...TODOS_ABORDAJES, 'Retroperitoneal', 'Microcirugía', 'Vaginal',
] as const;
export const ROLES = ['Cirujano principal', 'Primer ayudante', 'Segundo ayudante', 'Observador'];

export function getAbordajesDisponibles(categoria: string, procedimiento: string): string[] {
  const rule = REGLAS_ABORDAJE[categoria]?.[procedimiento];
  const approaches = Array.isArray(rule)
    ? [...rule]
    : rule === SELECTABLE || !rule
      ? [...TODOS_ABORDAJES_AMPLIADOS]
      : [rule as string];
  return CATEGORIES_WITHOUT_VAGINAL_APPROACH.has(categoria)
    ? approaches.filter(approach => approach !== 'Vaginal')
    : approaches;
}

export function getAbordajeFijo(categoria: string, procedimiento: string): string | null {
  const rule = REGLAS_ABORDAJE[categoria]?.[procedimiento];
  return typeof rule === 'string' && rule !== SELECTABLE ? rule : null;
}

export function getProcedimientoOrquiectomia(inguinal: boolean, protesis: boolean): string {
  if (inguinal && protesis) return 'Orquiectomía inguinal con prótesis';
  if (inguinal) return 'Orquiectomía inguinal';
  if (protesis) return 'Orquiectomía simple con prótesis';
  return 'Orquiectomía simple';
}
