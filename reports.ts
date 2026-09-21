import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate, authorize('MANAGER'));

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) {
      const t = new Date(to);
      t.setHours(23, 59, 59, 999);
      dateFilter.lte = t;
    }
    const hasDate = Object.keys(dateFilter).length > 0;

    const [totalAll, completedOrders, cancelledOrders, orderItems] = await Promise.all([
      prisma.order.count({ where: hasDate ? { orderDate: dateFilter } : {} }),
      prisma.order.count({
        where: { status: 'Delivered', ...(hasDate ? { orderDate: dateFilter } : {}) },
      }),
      prisma.order.count({
        where: { status: 'Cancelled', ...(hasDate ? { orderDate: dateFilter } : {}) },
      }),
      prisma.orderItem.findMany({
        where: {
          order: {
            status: { not: 'Cancelled' },
            ...(hasDate ? { orderDate: dateFilter } : {}),
          },
        },
        include: { meal: true },
      }),
    ]);

    const counts: Record<string, Record<string, number>> = {
      rice: {}, protein: {}, salad: {}, fruit: {}, drink: {},
    };
    for (const item of orderItems) {
      const cat = item.category;
      const name = item.meal.nameEn;
      if (!counts[cat]) counts[cat] = {};
      counts[cat][name] = (counts[cat][name] || 0) + 1;
    }

    const most = (cat: string) => {
      let max = 0, maxName = '-';
      for (const [name, count] of Object.entries(counts[cat] || {})) {
        if (count > max) { max = count; maxName = name; }
      }
      return { name: maxName, count: max };
    };

    res.json({
      success: true,
      data: {
        totalOrders: totalAll,
        completedOrders,
        cancelledOrders,
        mostSelectedRice: most('rice'),
        mostSelectedProtein: most('protein'),
        mostSelectedSalad: most('salad'),
        mostSelectedFruit: most('fruit'),
        mostSelectedDrink: most('drink'),
        breakdown: counts,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

export default router;
