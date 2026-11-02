import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CATEGORIAS, getAbordajesDisponibles } from '../lib/categorias';
import { type PersonalProcedure } from '../lib/personalProcedures';
import { putPersonalProcedure, readPersonalProcedures, renamePersonalProcedure } from '../db/personalProcedureRepository';
import { getAllStoredProcedures } from '../db/procedureRepository';
import { useRemoteRevision } from '../sync/syncManager';

export default function PersonalCatalog() {
  const addDetails = useRef<HTMLDetailsElement>(null);
  const [catalog, setCatalog] = useState<PersonalProcedure[]>([]);
  const [editing, setEditing] = useState<PersonalProcedure | null>(null);
  const [categoria, setCategoria] = useState('');
  const [nombre, setNombre] = useState('');
  const [abordajes, setAbordajes] = useState<string[]>([]);
  const [formulario, setFormulario] = useState<PersonalProcedure['formulario']>('sencillo');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updateHistory, setUpdateHistory] = useState(false);
  const revision = useRemoteRevision();
  useEffect(() => { if (window.location.hash === '#procedimientos-personales') document.getElementById('procedimientos-personales')?.scrollIntoView(); }, []);
  useEffect(() => { let active = true; readPersonalProcedures().then(items => { if (active) setCatalog(items); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [revision]);
  function reset() { setUpdateHistory(false); setEditing(null); setCategoria(''); setNombre(''); setAbordajes([]); setFormulario('sencillo'); setError(''); }
  function edit(item: PersonalProcedure) { setEditing(item); setCategoria(item.categoria); setNombre(item.nombre); setAbordajes(item.abordajes); setFormulario(item.formulario); setError(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const now = new Date().toISOString();
      const next: PersonalProcedure = { id: editing?.id ?? crypto.randomUUID(), categoria, nombre: nombre.trim(), abordajes, formulario: categoria === 'Litiasis' ? formulario : 'sencillo', createdAt: editing?.createdAt ?? now, updatedAt: now, archivedAt: null };
      if (editing && next.nombre !== editing.nombre) {
        await renamePersonalProcedure(next, editing, updateHistory);
      } else {
        if (editing) {
          const used = (await getAllStoredProcedures()).some(p => p.categoria === editing.categoria && p.procedimiento === editing.nombre);
          if (used && (next.categoria !== editing.categoria || next.formulario !== editing.formulario)) {
            throw new Error('Esta técnica ya tiene cirugías registradas. Para conservarlas, crea una nueva técnica con otro nombre.');
          }
        }
        await putPersonalProcedure(next);
      }
      setCatalog(await readPersonalProcedures());
      if (!editing && addDetails.current) addDetails.current.open = false;
      reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }
  async function remove(item: PersonalProcedure) {
    if (!window.confirm(`¿Eliminar «${item.nombre}» de tus procedimientos? Las cirugías ya registradas se conservarán.`)) return;
    setError(''); setBusy(true);
    try {
      const now = new Date().toISOString();
      await putPersonalProcedure({ ...item, updatedAt: now, archivedAt: now });
      setCatalog(await readPersonalProcedures());
      if (editing?.id === item.id) reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo eliminar.'); }
    finally { setBusy(false); }
  }
  function editor() {
    return <form onSubmit={save}>
      <label htmlFor="personal-categoria">Categoría</label>
      <select id="personal-categoria" value={categoria} required onChange={e => { setCategoria(e.target.value); setAbordajes([]); setFormulario('sencillo'); }}>
        <option value="">Seleccionar categoría</option>{Object.keys(CATEGORIAS).map(value => <option key={value}>{value}</option>)}
      </select>
      <label htmlFor="personal-nombre">Nombre</label>
      <input id="personal-nombre" maxLength={120} value={nombre} onChange={e => setNombre(e.target.value)} required />
      {categoria === 'Litiasis' && <><label htmlFor="personal-formulario">Datos del formulario</label>
        <select id="personal-formulario" value={formulario} onChange={e => setFormulario(e.target.value as PersonalProcedure['formulario'])}>
          <option value="sencillo">Formulario sencillo</option><option value="litiasis">Con datos de litiasis</option><option value="percutaneo">Con datos de litiasis y percutáneos</option>
        </select></>}
      {editing && nombre.trim() !== editing.nombre && <fieldset style={{ border: 0, padding: '10px 0' }}><legend>Cirugías anteriores</legend>
        <label style={{ display: 'block' }}><input type="radio" name="personal-renombrar" checked={!updateHistory} onChange={() => setUpdateHistory(false)} style={{ width: 'auto', marginRight: 6 }} />Conservar el nombre anterior</label>
        <label style={{ display: 'block' }}><input type="radio" name="personal-renombrar" checked={updateHistory} onChange={() => setUpdateHistory(true)} style={{ width: 'auto', marginRight: 6 }} />Actualizar el nombre en las cirugías anteriores</label>
      </fieldset>}
      <fieldset style={{ border: 0, padding: '10px 0' }}><legend>Abordajes disponibles *</legend>
        {categoria && getAbordajesDisponibles(categoria, '').map(value => <label key={value} style={{ display: 'block' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={abordajes.includes(value)} onChange={e => setAbordajes(items => e.target.checked ? [...items, value] : items.filter(item => item !== value))} />{value}
        </label>)}
      </fieldset>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      <button className="btn-primary" disabled={busy}>{editing ? 'Guardar cambios' : 'Añadir procedimiento'}</button>
      {editing && <button type="button" className="btn-ghost" onClick={reset}>Cancelar</button>}
    </form>;
  }
  return <details id="procedimientos-personales" className="card" style={{ marginBottom: 16 }}>
    <summary style={{ fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Mis procedimientos</summary>
    <p style={{ fontSize: 13 }}>Añade técnicas recurrentes a tu catálogo personal. Si eliminas una técnica, las cirugías anteriores se conservan.</p>
    {catalog.filter(item => !item.archivedAt).map(item => <details key={item.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }} onClick={event => { if (event.currentTarget.parentElement?.hasAttribute('open') && editing?.id === item.id) reset(); }}>{item.nombre}</summary>
      <div style={{ fontSize: 13, marginTop: 8 }}>{item.categoria} · {item.abordajes.join(', ')}</div>
      {editing?.id === item.id ? editor() : <>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => edit(item)}>Editar</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void remove(item)}>Eliminar</button>
      </>}
    </details>)}
    <details ref={addDetails} style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }} onClick={reset}>Añadir procedimiento</summary>
      {!editing && editor()}
    </details>
    {error && !editing && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
  </details>;
}
