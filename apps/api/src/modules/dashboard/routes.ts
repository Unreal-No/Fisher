// Executive dashboard. Every figure is computed from DB records for the requested range/vessel.
import type { FastifyInstance } from 'fastify';
import { AT_SEA_STATUSES, toISODate } from '@fisher/shared';
import { d, num, scopeIds } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { has } from '../../plugins/auth';

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/summary', { preHandler: app.can('dashboard.view') }, async (req) => {
    const f = req.query as { from?: string; to?: string; vesselId?: string };
    const today = toISODate();
    const from = f.from ?? `${today.slice(0, 7)}-01`;
    const to = f.to ?? today;
    const scope = scopeIds(req);
    const vesselIds = f.vesselId ? (scope && !scope.includes(f.vesselId) ? ['00000000-0000-0000-0000-000000000000'] : [f.vesselId]) : scope;
    const vWhere = vesselIds ? { vesselId: { in: vesselIds } } : {};
    const rangeStart = new Date(`${from}T00:00:00+07:00`);
    const rangeEnd = new Date(`${to}T23:59:59.999+07:00`);
    const in30 = new Date(Date.now() + 30 * 86400_000);
    const in90 = new Date(Date.now() + 90 * 86400_000);
    const empScope = vesselIds ? { currentVesselId: { in: vesselIds } } : {};
    const activeEmp = { deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'] as ('ACTIVE' | 'ON_LEAVE' | 'SUSPENDED')[] }, ...empScope };

    const [vesselStatus, workers, docExpired, docExp30, docExp90, currentTrips, catchSum, catchBySpecies, fuel, expenses, alerts, recentCatch] =
      await Promise.all([
        prisma.vessel.groupBy({ by: ['status'], where: { deletedAt: null, ...(vesselIds ? { id: { in: vesselIds } } : {}) }, _count: true }),
        prisma.employee.count({ where: { deletedAt: null, status: 'ACTIVE', ...empScope } }),
        prisma.employeeDocument.count({ where: { status: 'ACTIVE', expiryDate: { lt: d(today) }, employee: activeEmp } }),
        prisma.employeeDocument.count({ where: { status: 'ACTIVE', expiryDate: { gte: d(today), lte: in30 }, employee: activeEmp } }),
        prisma.employeeDocument.count({ where: { status: 'ACTIVE', expiryDate: { gte: d(today), lte: in90 }, employee: activeEmp } }),
        prisma.fishingTrip.findMany({
          where: { ...vWhere, status: { in: [...AT_SEA_STATUSES, 'ARRIVED', 'PREPARING'] } },
          include: { vessel: { select: { id: true, name: true, code: true } }, _count: { select: { crew: true } } },
          orderBy: { departedAt: 'asc' },
          take: 20,
        }),
        prisma.catchRecord.aggregate({ where: { ...vWhere, voidedAt: null, catchDate: { gte: d(from), lte: d(to) } }, _sum: { weightKg: true }, _count: true }),
        prisma.catchRecord.groupBy({
          by: ['speciesId'], where: { ...vWhere, voidedAt: null, catchDate: { gte: d(from), lte: d(to) } },
          _sum: { weightKg: true }, orderBy: { _sum: { weightKg: 'desc' } }, take: 8,
        }),
        prisma.tripFuel.aggregate({ where: { trip: vWhere, recordedAt: { gte: rangeStart, lte: rangeEnd } }, _sum: { liters: true, totalCost: true } }),
        prisma.tripExpense.groupBy({ by: ['isEstimate'], where: { trip: vWhere, expenseDate: { gte: d(from), lte: d(to) } }, _sum: { amount: true } }),
        prisma.employeeDocument.findMany({
          where: { status: 'ACTIVE', expiryDate: { lte: in30 }, employee: activeEmp },
          include: { documentType: { select: { nameTh: true } }, employee: { select: { id: true, code: true, firstName: true, lastName: true } } },
          orderBy: { expiryDate: 'asc' },
          take: 10,
        }),
        prisma.catchRecord.findMany({
          where: { ...vWhere, voidedAt: null },
          include: { species: { select: { nameTh: true } }, vessel: { select: { name: true } }, trip: { select: { id: true, tripNo: true } } },
          orderBy: { createdAt: 'desc' },
          take: 8,
        }),
      ]);
    const [speciesNames, vesselAlerts, monthly] = await Promise.all([
      prisma.fishSpecies.findMany({ where: { id: { in: catchBySpecies.map((s) => s.speciesId) } }, select: { id: true, nameTh: true } }),
      prisma.vessel.findMany({
        where: { deletedAt: null, status: { not: 'INACTIVE' }, licenseExpiry: { lte: in30 }, ...(vesselIds ? { id: { in: vesselIds } } : {}) },
        select: { id: true, code: true, name: true, licenseExpiry: true },
        orderBy: { licenseExpiry: 'asc' },
      }),
      prisma.$queryRaw<{ month: Date; kg: string }[]>`
        SELECT date_trunc('month', catch_date)::date AS month, SUM(weight_kg) AS kg FROM catch_records
        WHERE voided_at IS NULL AND catch_date >= (date_trunc('month', ${d(to)}::date) - interval '11 months')
          AND catch_date <= ${d(to)}::date
          ${vesselIds ? Prisma.sql`AND vessel_id = ANY(${vesselIds}::uuid[])` : Prisma.empty}
        GROUP BY 1 ORDER BY 1`,
    ]);
    const byStatus = Object.fromEntries(vesselStatus.map((v) => [v.status, v._count]));
    const finance = has(req, 'dashboard.finance');
    let sales: { revenue: number; soldKg: number; receivables: number; suppliesCost: number; estimatedProfit: number } | null = null;
    if (finance) {
      const [lines, open, supplies] = await Promise.all([
        prisma.salesItem.findMany({
          where: { invoice: { status: 'CONFIRMED', invoiceDate: { gte: d(from), lte: d(to) } }, ...(vesselIds ? { vesselId: { in: vesselIds } } : {}) },
          select: { lineTotal: true, discountShare: true, returnedAmount: true, weightKg: true, returnedKg: true },
        }),
        prisma.salesInvoice.aggregate({ where: { status: 'CONFIRMED' }, _sum: { total: true, paidAmount: true, creditedAmount: true } }),
        prisma.tripSupply.aggregate({ where: { trip: vWhere, createdAt: { gte: rangeStart, lte: rangeEnd } }, _sum: { totalCost: true } }),
      ]);
      const revenue = lines.reduce((a, l) => a + num(l.lineTotal) - num(l.discountShare) - num(l.returnedAmount), 0);
      const exp = num(expenses.find((e) => !e.isEstimate)?._sum.amount) + num(expenses.find((e) => e.isEstimate)?._sum.amount);
      const suppliesCost = num(supplies._sum.totalCost);
      sales = {
        revenue: Math.round(revenue * 100) / 100,
        soldKg: Math.round(lines.reduce((a, l) => a + num(l.weightKg) - num(l.returnedKg), 0) * 1000) / 1000,
        receivables: Math.round((num(open._sum.total) - num(open._sum.paidAmount) - num(open._sum.creditedAmount)) * 100) / 100,
        suppliesCost,
        estimatedProfit: Math.round((revenue - num(fuel._sum.totalCost) - exp - suppliesCost) * 100) / 100,
      };
    }
    return {
      range: { from, to },
      vessels: {
        total: vesselStatus.reduce((a, v) => a + v._count, 0),
        atSea: byStatus.AT_SEA ?? 0,
        atPort: byStatus.AT_PORT ?? 0,
        maintenance: byStatus.MAINTENANCE ?? 0,
        inactive: byStatus.INACTIVE ?? 0,
      },
      workers: { active: workers, docExpired, docExpiring30: docExp30, docExpiring90: docExp90 },
      trips: {
        current: currentTrips.map(({ _count, ...t }) => ({ ...t, crewCount: _count.crew })),
        atSeaCount: currentTrips.filter((t) => AT_SEA_STATUSES.includes(t.status)).length,
      },
      catch: {
        totalKg: num(catchSum._sum.weightKg),
        records: catchSum._count,
        bySpecies: catchBySpecies.map((s) => ({ name: speciesNames.find((x) => x.id === s.speciesId)?.nameTh ?? '-', weightKg: num(s._sum.weightKg) })),
        monthly: monthly.map((m) => ({ month: m.month.toISOString().slice(0, 7), weightKg: num(m.kg) })),
      },
      fuel: { liters: num(fuel._sum.liters), cost: finance ? num(fuel._sum.totalCost) : null },
      expenses: finance
        ? { confirmed: num(expenses.find((e) => !e.isEstimate)?._sum.amount), estimated: num(expenses.find((e) => e.isEstimate)?._sum.amount) }
        : null,
      sales,
      alerts: {
        documents: alerts.map((a) => ({
          id: a.id, employeeId: a.employee.id, employee: `${a.employee.code} ${a.employee.firstName} ${a.employee.lastName}`,
          documentType: a.documentType.nameTh, expiryDate: a.expiryDate,
        })),
        vessels: vesselAlerts,
      },
      recentCatch,
    };
  });
}
