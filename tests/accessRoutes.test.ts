import assert from 'node:assert/strict';
import test from 'node:test';
import { accessRouteOf, formatApproach, supportsAccessRoute } from '../src/lib/accessRoutes';
import { validateCases } from '../src/sync/syncModel';
import { surgery } from './helpers/syncHarness';

test('the route selector covers upper tract procedures without changing lithiasis', () => {
  assert.equal(supportsAccessRoute('Patología renal', 'Suprarrenalectomía'), true);
  assert.equal(supportsAccessRoute('Patología renal', 'Nefroureterectomía'), true);
  assert.equal(supportsAccessRoute('Patología ureteral', 'Pielo/ureterolitotomía'), true);
  assert.equal(supportsAccessRoute('Cirugía de trasplante', 'Extracción renal donante vivo'), true);
  assert.equal(supportsAccessRoute('Litiasis', 'RIRS'), false);
  assert.equal(supportsAccessRoute('Patología linfática', 'Linfadenectomía'), false);
});

test('legacy retroperitoneal cases retain their known route without inventing a technique', () => {
  const old: Record<string, unknown> = { ...surgery(), abordaje: 'Retroperitoneal' };
  delete old.via_acceso;
  const normalized = validateCases({ 'case-1': { procedure: old, stone: null } });
  const procedure = (normalized['case-1'] as { procedure: ReturnType<typeof surgery> }).procedure;
  assert.equal(procedure.abordaje, 'Retroperitoneal');
  assert.equal(accessRouteOf(procedure), 'Retroperitoneal');
  assert.equal(formatApproach(procedure), 'Retroperitoneal');
  assert.throws(() => validateCases({ 'case-1': { procedure: { ...old, via_acceso: 'Inventada' }, stone: null } }), /vía de acceso/);
});
