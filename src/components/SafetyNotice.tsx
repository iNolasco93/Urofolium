interface SafetyNoticeProps {
  compact?: boolean;
  summary?: boolean;
}

export default function SafetyNotice({ compact = false, summary = false }: SafetyNoticeProps) {
  return (
    <div
      role="note"
      style={{
        background: 'var(--info-bg)',
        border: '1px solid var(--info-border)',
        borderRadius: 8,
        padding: compact ? '10px 12px' : '14px 16px',
        color: 'var(--text)',
        fontSize: compact ? 12 : 13,
        lineHeight: 1.45,
        textAlign: 'left',
      }}
    >
      {!summary && (
        <p style={{ margin: '0 0 8px' }}>No introduzcas nombre, NHC, fecha de nacimiento, teléfono ni ningún dato que identifique a un paciente.</p>
      )}
      <p style={{ margin: '0 0 8px' }}>Los registros se guardan localmente en este dispositivo. La exportación local y las copias en Drive dependen de ti.</p>
      <p style={{ margin: 0 }}>Esta herramienta es un logbook formativo para residentes y no sustituye los sistemas oficiales del hospital.</p>
    </div>
  );
}
