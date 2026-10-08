import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';

const RULES = process.env.RULES || 'firestore.rules';
let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-repartos',
    firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'usuarios/admin1'), { rol: 'admin', activo: true });
    await setDoc(doc(db, 'usuarios/adminInactivo'), { rol: 'admin', activo: false });
    await setDoc(doc(db, 'usuarios/chofer1'), { rol: 'repartidor', repartidorId: 'R1', nombre: 'Juan' });
    await setDoc(doc(db, 'usuarios/chofer2'), { rol: 'repartidor', repartidorId: 'R2', nombre: 'Ana' });
    await setDoc(doc(db, 'Pedidos/P1'), { codigo_barra: 'LEEN-1029', estado: 'pendiente', repartidor_id: 'R1', cliente_nombre: 'Camila' });
    await setDoc(doc(db, 'Pedidos/P2'), { codigo_barra: 'LEEN-3045', estado: 'en_camino', repartidor_id: 'R2' });
    await setDoc(doc(db, 'Pedidos/P3'), { codigo_barra: 'LEEN-7711', estado: 'entregado', repartidor_id: 'R1' });
    await setDoc(doc(db, 'Pedidos/P4'), { codigo_barra: 'LEEN-9081', estado: 'pendiente' });
    await setDoc(doc(db, 'Clientes/C1'), { nombre: 'Camila', telefono: '56912345678' });
  });
});

const como = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe('Seguridad básica (debe cumplirse con ambas versiones)', () => {
  it('sin login no se lee ningún pedido (ver-pedidos.html)', async () => {
    await assertFails(getDocs(collection(como(null), 'Pedidos')));
  });
  it('sin login no se leen clientes', async () => {
    await assertFails(getDoc(doc(como(null), 'Clientes/C1')));
  });
  it('un chofer no puede asignarse rol admin', async () => {
    await assertFails(updateDoc(doc(como('chofer1'), 'usuarios/chofer1'), { rol: 'admin' }));
  });
  it('un chofer no lee clientes', async () => {
    await assertFails(getDoc(doc(como('chofer1'), 'Clientes/C1')));
  });
  it('un chofer lee solo sus pedidos', async () => {
    await assertSucceeds(getDocs(query(collection(como('chofer1'), 'Pedidos'), where('repartidor_id', '==', 'R1'))));
    await assertFails(getDoc(doc(como('chofer1'), 'Pedidos/P2')));
    await assertFails(getDocs(collection(como('chofer1'), 'Pedidos')));
  });
  it('un chofer no se reasigna pedidos de otro', async () => {
    await assertFails(updateDoc(doc(como('chofer1'), 'Pedidos/P2'), { estado: 'entregado' }));
    await assertFails(updateDoc(doc(como('chofer1'), 'Pedidos/P1'), { repartidor_id: 'R2' }));
  });
  it('un chofer no ve pedidos sin asignar', async () => {
    await assertFails(getDoc(doc(como('chofer1'), 'Pedidos/P4')));
  });
  it('un admin inactivo queda bloqueado', async () => {
    await assertFails(getDoc(doc(como('adminInactivo'), 'Pedidos/P1')));
  });
  it('el admin lee y edita todo', async () => {
    await assertSucceeds(getDocs(collection(como('admin1'), 'Pedidos')));
    await assertSucceeds(updateDoc(doc(como('admin1'), 'Pedidos/P1'), { estado: 'en_camino' }));
    await assertSucceeds(deleteDoc(doc(como('admin1'), 'Pedidos/P4')));
  });
});

describe('Flujos de la app actual', () => {
  it('chofer cambia estado con el selector (pendiente → en_camino)', async () => {
    await assertSucceeds(updateDoc(doc(como('chofer1'), 'Pedidos/P1'), { estado: 'en_camino' }));
  });
  it('chofer confirma entrega por escáner (estado + fecha_entrega del servidor)', async () => {
    await assertSucceeds(updateDoc(doc(como('chofer1'), 'Pedidos/P1'), { estado: 'entregado', fecha_entrega: serverTimestamp() }));
  });
  it('admin registra paquete por escáner', async () => {
    await assertSucceeds(setDoc(doc(como('admin1'), 'Pedidos/LEEN-5555'), {
      codigo_barra: 'LEEN-5555', estado: 'pendiente', fecha_recepcion: serverTimestamp(), creado_por: 'Administrador (Escáner)',
    }));
  });
});

describe('Integridad de datos (solo versión corregida)', () => {
  it('chofer no puede revertir un pedido entregado', async () => {
    await assertFails(updateDoc(doc(como('chofer1'), 'Pedidos/P3'), { estado: 'pendiente' }));
  });
  it('chofer no puede inventar estados', async () => {
    await assertFails(updateDoc(doc(como('chofer1'), 'Pedidos/P1'), { estado: 'perdido' }));
  });
  it('chofer no puede falsificar la fecha de entrega', async () => {
    await assertFails(updateDoc(doc(como('chofer1'), 'Pedidos/P1'), {
      estado: 'entregado', fecha_entrega: Timestamp.fromDate(new Date('2026-01-01')),
    }));
  });
  it('fecha_entrega solo al entregar', async () => {
    await assertFails(updateDoc(doc(como('chofer1'), 'Pedidos/P1'), { estado: 'no_entregado', fecha_entrega: serverTimestamp() }));
  });
  it('admin no puede guardar estados inválidos ni códigos vacíos', async () => {
    await assertFails(updateDoc(doc(como('admin1'), 'Pedidos/P1'), { estado: 'xx' }));
    await assertFails(setDoc(doc(como('admin1'), 'Pedidos/P9'), { codigo_barra: '', estado: 'pendiente' }));
  });
  it('admin no puede guardar textos gigantes', async () => {
    await assertFails(updateDoc(doc(como('admin1'), 'Pedidos/P1'), { direccion_entrega: 'x'.repeat(5000) }));
  });
});
