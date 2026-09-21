import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/manager', authenticate, authorize('MANAGER'), async (_req: AuthRequest, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalPatients,
      totalEmployees,
      todayOrders,
      pendingOrders,
      completedOrders,
      cancelledOrders,
      recentOrders,
      ordersByStatus,
    ] = await Promise.all([
      prisma.patient.count(),
      prisma.employee.count(),
      prisma.order.count({ where: { orderDate: { gte: todayStart } } }),
      prisma.order.count({
        where: { status: { in: ['New', 'Preparing'] }, orderDate: { gte: todayStart } },
      }),
      prisma.order.count({
        where: { status: 'Delivered', orderDate: { gte: todayStart } },
      }),
      prisma.order.count({
        where: { status: 'Cancelled', orderDate: { gte: todayStart } },
      }),
      prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { meal: true } },
          patient: { include: { user: true } },
        },
      }),
      prisma.order.groupBy({
        by: ['status'],
        _count: true,
        where: { orderDate: { gte: todayStart } },
      }),
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orderItems = await prisma.orderItem.findMany({
      where: { order: { orderDate: { gte: thirtyDaysAgo }, status: { not: 'Cancelled' } } },
      include: { meal: true },
    });

    const statsByCategory: Record<string, Record<string, number>> = {
      rice: {}, protein: {}, salad: {}, fruit: {}, drink: {},
    };

    for (const item of orderItems) {
      const cat = item.category;
      const name = item.meal.nameEn;
      if (!statsByCategory[cat]) statsByCategory[cat] = {};
      statsByCategory[cat][name] = (statsByCategory[cat][name] || 0) + 1;
    }

    const ordersByDay: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const count = await prisma.order.count({
        where: { orderDate: { gte: d, lt: next } },
      });
      ordersByDay.push({ date: d.toISOString().slice(0, 10), count });
    }

    res.json({
      success: true,
      data: {
        cards: {
          totalPatients, totalEmployees, todayOrders, pendingOrders, completedOrders, cancelledOrders,
        },
        charts: {
          rice: statsByCategory.rice,
          protein: statsByCategory.protein,
          salad: statsByCategory.salad,
          fruit: statsByCategory.fruit,
          drink: statsByCategory.drink,
          ordersByDay,
          ordersByStatus: Object.fromEntries(ordersByStatus.map((s) => [s.status, s._count])),
        },
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          patientName: o.patient?.user?.name,
          patientId: o.patient?.patientId,
          roomNumber: o.patient?.roomNumber,
          createdAt: o.createdAt,
        })),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
});

router.get('/employee', authenticate, authorize('EMPLOYEE', 'MANAGER'), async (_req, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [newCount, preparingCount, readyCount, todayTotal] = await Promise.all([
      prisma.order.count({ where: { status: 'New', orderDate: { gte: todayStart } } }),
      prisma.order.count({ where: { status: 'Preparing', orderDate: { gte: todayStart } } }),
      prisma.order.count({ where: { status: 'Ready', orderDate: { gte: todayStart } } }),
      prisma.order.count({ where: { orderDate: { gte: todayStart } } }),
    ]);
    res.json({ success: true, data: { newCount, preparingCount, readyCount, todayTotal } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
});

export default router;
