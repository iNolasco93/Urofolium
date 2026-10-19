export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS procedures (
        id                TEXT    PRIMARY KEY,
        fecha             TEXT    NOT NULL,
        categoria         TEXT    NOT NULL,
        procedimiento     TEXT    NOT NULL,
        abordaje          TEXT    NOT NULL,
        duracion          INTEGER,
        rol               TEXT    NOT NULL,
        cirujano_senior   TEXT,
        segundo_ayudante  TEXT,
        complicaciones    TEXT,
        otro_especificar  TEXT,
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL,
        deleted_at        TEXT
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '1');
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS stone_details (
        procedure_id           TEXT    PRIMARY KEY,
        lateralidad            TEXT,
        procedimiento_raw      TEXT    NOT NULL,
        nefromax_fr            INTEGER,
        amplatz_fr             INTEGER,
        enhebrado              INTEGER NOT NULL DEFAULT 0,
        tamanio_mm             REAL,
        tutor_interno          TEXT,
        drenaje_nefrostomico   TEXT,
        sonda_fr               INTEGER,
        etiqueta_drenaje       TEXT,
        stonefree              INTEGER,
        created_at             TEXT    NOT NULL,
        updated_at             TEXT    NOT NULL,
        FOREIGN KEY (procedure_id) REFERENCES procedures(id)
      );

      CREATE INDEX IF NOT EXISTS idx_stone_details_procedure_id
        ON stone_details (procedure_id);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE procedures ADD COLUMN primer_ayudante TEXT;
    `,
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
