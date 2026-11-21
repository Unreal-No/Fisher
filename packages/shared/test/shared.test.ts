import { describe, expect, it } from 'vitest';
import {
  beYear, canTransition, catchCreateSchema, daysUntil, formatDate, maskId, ROLE_DEFS, ALL_PERMISSIONS,
  vesselSchema, toISODate, isActiveTrip,
} from '../src';

describe('format', () => {
  it('formats Buddhist Era dates in Bangkok time', () => {
    expect(formatDate('2026-11-20T18:30:00Z')).toContain('2569'); // 21 Nov 01:30 BKK
    expect(formatDate('2026-11-20T18:30:00Z')).toMatch(/^21/);
    expect(beYear(new Date('2026-06-01'))).toBe(2569);
    expect(formatDate(null)).toBe('-');
  });
  it('computes days until in Bangkok calendar', () => {
    const from = new Date('2026-11-21T03:00:00Z');
    expect(daysUntil('2026-11-28', from)).toBe(7);
    expect(daysUntil('2026-11-20', from)).toBe(-1);
    expect(toISODate(new Date('2026-11-20T18:30:00Z'))).toBe('2026-11-21');
  });
  it('masks identifiers', () => {
    expect(maskId('AB1234567')).toBe('AB*****67');
    expect(maskId('123')).toBe('***');
    expect(maskId(null)).toBeNull();
  });
});

describe('trip state machine', () => {
  it('allows only defined transitions', () => {
    expect(canTransition('DRAFT', 'PREPARING')).toBe(true);
    expect(canTransition('PREPARING', 'DEPARTED')).toBe(true);
    expect(canTransition('DEPARTED', 'CANCELLED')).toBe(false);
    expect(canTransition('CLOSED', 'ARRIVED')).toBe(false);
    expect(canTransition('ARRIVED', 'PENDING_SETTLEMENT')).toBe(true);
  });
  it('active statuses occupy vessel', () => {
    expect(isActiveTrip('AT_SEA')).toBe(true);
    expect(isActiveTrip('PENDING_SETTLEMENT')).toBe(false);
    expect(isActiveTrip('DRAFT')).toBe(false);
  });
});

describe('schemas', () => {
  it('converts blank form values to null and numbers from strings', () => {
    const r = vesselSchema.parse({ name: 'ส.ทะเลทอง 1', registrationNo: '123-45', vesselType: 'อวนลาก', lengthM: '18.5', widthM: '', notes: '' });
    expect(r.lengthM).toBe(18.5);
    expect(r.widthM).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.status).toBe('AT_PORT');
  });
  it('rejects non-positive catch weight', () => {
    const base = { tripId: crypto.randomUUID(), speciesId: crypto.randomUUID(), catchDate: '2026-11-21' };
    expect(catchCreateSchema.safeParse({ ...base, weightKg: 0 }).success).toBe(false);
    expect(catchCreateSchema.safeParse({ ...base, weightKg: '12.5' }).success).toBe(true);
  });
});

describe('rbac catalogue', () => {
  it('super admin has all permissions; viewer has no sensitive access', () => {
    expect(ROLE_DEFS.SUPER_ADMIN!.permissions.length).toBe(ALL_PERMISSIONS.length);
    expect(ROLE_DEFS.VIEWER!.permissions).not.toContain('employee.sensitive');
    expect(ROLE_DEFS.VIEWER!.permissions.every((p) => p.endsWith('.view'))).toBe(true);
  });
});

describe('numeric input hardening', () => {
  it('rejects non-numeric text instead of silently clearing it', () => {
    const r = vesselSchema.safeParse({ name: 'a', registrationNo: 'b', vesselType: 'c', lengthM: 'abc' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('กรุณากรอกตัวเลข');
    expect(vesselSchema.parse({ name: 'a', registrationNo: 'b', vesselType: 'c', grossTonnage: '1,234.5' }).grossTonnage).toBe(1234.5);
    const c = catchCreateSchema.safeParse({ tripId: crypto.randomUUID(), speciesId: crypto.randomUUID(), catchDate: '2026-11-21', weightKg: '' });
    expect(c.error!.issues[0]!.message).toBe('กรุณากรอกข้อมูล');
  });
});
