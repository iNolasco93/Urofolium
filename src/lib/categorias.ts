export const SELECTABLE = '__SELECTABLE__';

export const CATEGORIAS: Record<string, string[]> = {
  'Endourología': [
    'RTU vesical', 'RTU prostática', 'RTU cuello',
    'Uretrotomía interna', 'BVM', 'Botox', 'Otros'
  ],
  'Litiasis': [
    'NLPC', 'ECIRS', 'URS', 'RIRS',
    'Cistolitotricia', 'Cistolitotomía', 'Otros'
  ],
  'Cirugía renal y ureteral': [
    'Nefrectomía radical', 'Nefroureterectomía', 'Nefrectomía parcial',
    'Tumorectomía renal', 'Pieloplastia', 'Pielo/ureterolitotomía', 'Otros'
  ],
  'Cirugía pélvica y prostática mayor': [
    'Prostatectomía radical', 'Cistectomía radical',
    'Adenomectomía suprapúbica', 'Otros'
  ],
  'Derivaciones urinarias': [
    'Colocación JJ', 'Nefrostomía', 'Talla vesical', 'Otros'
  ],
  'Genital masculina': [
    'Vasectomía', 'Circuncisión', 'Frenuloplastia', 'Quiste escrotal',
    'Meatotomía', 'Hidrocelectomía', 'Varicocelectomía',
    'Exéresis de quiste de epidídimo', 'Lipoma de cordón espermático',
    'Fournier', 'Orquiectomía', 'Orquidopexia', 'Prótesis testicular',
    'Penectomía parcial', 'Penectomía total', 'Cirugía de Peyronie', 'Otros'
  ],
  'Suelo pélvico / continencia': [
    'TOT', 'Colporrafia anterior', 'Esfínter artificial',
    'Carúncula uretral', 'Otros'
  ]
};

export const REGLAS_ABORDAJE: Record<string, Record<string, string>> = {
  'Endourología': {
    'RTU vesical': 'Endoscópico', 'RTU prostática': 'Endoscópico',
    'RTU cuello': 'Endoscópico', 'Uretrotomía interna': 'Endoscópico',
    'BVM': 'Endoscópico', 'Botox': 'Endoscópico', 'Otros': 'Endoscópico'
  },
  'Litiasis': {
    'NLPC': 'Percutáneo', 'ECIRS': 'Percutáneo',
    'URS': 'Endoscópico', 'RIRS': 'Endoscópico',
    'Cistolitotricia': 'Endoscópico', 'Cistolitotomía': 'Abierto',
    'Otros': SELECTABLE
  },
  'Cirugía renal y ureteral': {
    'Nefrectomía radical': SELECTABLE, 'Nefroureterectomía': SELECTABLE,
    'Nefrectomía parcial': SELECTABLE, 'Tumorectomía renal': SELECTABLE,
    'Pieloplastia': SELECTABLE, 'Pielo/ureterolitotomía': SELECTABLE,
    'Otros': SELECTABLE
  },
  'Cirugía pélvica y prostática mayor': {
    'Prostatectomía radical': SELECTABLE, 'Cistectomía radical': SELECTABLE,
    'Adenomectomía suprapúbica': SELECTABLE, 'Otros': SELECTABLE
  },
  'Derivaciones urinarias': {
    'Colocación JJ': 'Endoscópico', 'Nefrostomía': 'Percutáneo',
    'Talla vesical': 'Percutáneo', 'Otros': SELECTABLE
  },
  'Genital masculina': {
    'Vasectomía': 'Abierto', 'Circuncisión': 'Abierto',
    'Frenuloplastia': 'Abierto', 'Meatotomía': 'Abierto',
    'Hidrocelectomía': 'Abierto', 'Varicocelectomía': 'Abierto',
    'Exéresis de quiste de epidídimo': 'Abierto',
    'Lipoma de cordón espermático': 'Abierto',
    'Fournier': 'Abierto',
    'Orquiectomía': 'Abierto',
    'Orquiectomía inguinal': 'Abierto',
    'Orquiectomía inguinal + prótesis': 'Abierto',
    'Orquiectomía simple / escrotal': 'Abierto',
    'Orquidopexia': 'Abierto',
    'Prótesis testicular': 'Abierto',
    'Penectomía parcial': 'Abierto', 'Penectomía total': 'Abierto',
    'Cirugía de Peyronie': 'Abierto',
    'Quiste escrotal': 'Abierto', 'Otros': 'Abierto'
  },
  'Suelo pélvico / continencia': {
    'TOT': 'Abierto', 'Colporrafia anterior': 'Abierto',
    'Esfínter artificial': 'Abierto', 'Carúncula uretral': 'Abierto',
    'Otros': 'Abierto'
  }
};

export const ABORDAJES_SELECCIONABLES = ['Abierto', 'Laparoscópico', 'Robótico'];
export const TODOS_ABORDAJES = ['Abierto', 'Endoscópico', 'Percutáneo', 'Laparoscópico', 'Robótico'];
export const ROLES = ['Cirujano principal', 'Primer ayudante', 'Segundo ayudante', 'Observador'];
