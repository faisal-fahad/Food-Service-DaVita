import { Router, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { logActivity } from '../utils/activityLog';

const router = Router();

function generateOrderNumber(): string {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `ORD-${y}${m}${d}-${rand}`;
}

async function createNotification(
  userId: string,
  titleEn: string,
  titleAr: string,
  messageEn: string,
  messageAr: string,
  type = 'order_status'
) {
  await prisma.notification.create({
    data: { userId, titleEn, titleAr, messageEn, messageAr, type },
  });
}

// Patient: create order
router.post('/', authenticate, authorize('PATIENT'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      riceId: z.string(),
      proteinId: z.string(),
      saladId: z.string(),
      fruitId: z.string(),
      drinkId: z.string(),
      mealSize: z.enum(['Small', 'Regular', 'Large']).default('Regular'),
      temperature: z.enum(['Hot', 'Normal']).default('Hot'),
      preferences: z.array(z.string()).optional().default([]),
      notes: z.string().optional().nullable(),
      dietaryRestrictions: z.array(z.string()).optional().default([]),
      allergies: z.array(z.string()).optional().default([]),
    });
    const data = schema.parse(req.body);

    const patient = await prisma.patient.findUnique({
      where: { userId: req.user!.id },
      include: { user: true },
    });
    if (!patient) {
      return res.status(400).json({ success: false, message: 'Patient profile not found' });
    }

    // Check for existing open order today (optional business rule)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const existing = await prisma.order.findFirst({
      where: {
        patientId: patient.id,
        orderDate: { gte: todayStart },
        status: { notIn: ['Cancelled', 'Delivered'] },
      },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active order for today. Please edit or cancel it first.',
        data: { orderId: existing.id, orderNumber: existing.orderNumber },
      });
    }

    const mealIds = [data.riceId, data.proteinId, data.saladId, data.fruitId, data.drinkId];
    const meals = await prisma.meal.findMany({
      where: { id: { in: mealIds }, isActive: true },
      include: { category: true },
    });
    if (meals.length !== 5) {
      return res.status(400).json({ success: false, message: 'One or more selected meals are invalid' });
    }

    const orderNumber = generateOrderNumber();
    const order = await prisma.order.create({
      data: {
        orderNumber,
        patientId: patient.id,
        createdById: req.user!.id,
        status: 'New',
        mealSize: data.mealSize,
        temperature: data.temperature,
        preferences: JSON.stringify(data.preferences),
        notes: data.notes || null,
        dietaryRestrictions: JSON.stringify(
          data.dietaryRestrictions.length
            ? data.dietaryRestrictions
            : patient.dietaryRestrictions
              ? JSON.parse(patient.dietaryRestrictions)
              : []
        ),
        allergies: JSON.stringify(
          data.allergies.length
            ? data.allergies
            : patient.allergies
              ? JSON.parse(patient.allergies)
              : []
        ),
        items: {
          create: meals.map((m) => ({
            mealId: m.id,
            category: m.category.slug,
          })),
        },
      },
      include: {
        items: { include: { meal: true } },
        patient: { include: { user: true } },
      },
    });

    // Update patient dietary/allergies if provided
    if (data.dietaryRestrictions.length || data.allergies.length) {
      await prisma.patient.update({
        where: { id: patient.id },
        data: {
          ...(data.dietaryRestrictions.length && {
            dietaryRestrictions: JSON.stringify(data.dietaryRestrictions),
          }),
          ...(data.allergies.length && { allergies: JSON.stringify(data.allergies) }),
        },
      });
    }

    await createNotification(
      req.user!.id,
      'Order Received',
      'تم استلام الطلب',
      `Your order ${orderNumber} has been received.`,
      `تم استلام طلبك رقم ${orderNumber}.`
    );

    await logActivity('Order Created', req.user!.id, `Order ${orderNumber} created`, req.ip);

    res.status(201).json({
      success: true,
      message: 'Order confirmed successfully',
      data: formatOrder(order),
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input', errors: err.errors });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

function formatOrder(order: any) {
  const itemsByCat: Record<string, any> = {};
  for (const item of order.items || []) {
    itemsByCat[item.category] = {
      id: item.meal.id,
      nameEn: item.meal.nameEn,
      nameAr: item.meal.nameAr,
      imageUrl: item.meal.imageUrl,
    };
  }
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    mealSize: order.mealSize,
    temperature: order.temperature,
    preferences: order.preferences ? JSON.parse(order.preferences) : [],
    notes: order.notes,
    dietaryRestrictions: order.dietaryRestrictions ? JSON.parse(order.dietaryRestrictions) : [],
    allergies: order.allergies ? JSON.parse(order.allergies) : [],
    orderDate: order.orderDate,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    rice: itemsByCat.rice || null,
    protein: itemsByCat.protein || null,
    salad: itemsByCat.salad || null,
    fruit: itemsByCat.fruit || null,
    drink: itemsByCat.drink || null,
    patient: order.patient
      ? {
          id: order.patient.id,
          patientId: order.patient.patientId,
          name: order.patient.user?.name,
          roomNumber: order.patient.roomNumber,
          bedNumber: order.patient.bedNumber,
          department: order.patient.department,
        }
      : null,
  };
}

// Patient: today's order / current order
router.get('/today', authenticate, authorize('PATIENT'), async (req: AuthRequest, res: Response) => {
  try {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const order = await prisma.order.findFirst({
      where: {
        patientId: patient.id,
        orderDate: { gte: todayStart },
        status: { not: 'Cancelled' },
      },
      include: {
        items: { include: { meal: true } },
        patient: { include: { user: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: order ? formatOrder(order) : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load order' });
  }
});

// Patient: order history
router.get('/history', authenticate, authorize('PATIENT'), async (req: AuthRequest, res: Response) => {
  try {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

    const orders = await prisma.order.findMany({
      where: { patientId: patient.id },
      include: {
        items: { include: { meal: true } },
        patient: { include: { user: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ success: true, data: orders.map(formatOrder) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load history' });
  }
});

// Patient: update order (before closed)
router.put('/:id', authenticate, authorize('PATIENT'), async (req: AuthRequest, res: Response) => {
  try {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

    const order = await prisma.order.findFirst({
      where: { id: req.params.id, patientId: patient.id },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (['Delivered', 'Cancelled', 'Ready'].includes(order.status)) {
      return res.status(400).json({ success: false, message: 'This order can no longer be modified' });
    }

    const schema = z.object({
      riceId: z.string().optional(),
      proteinId: z.string().optional(),
      saladId: z.string().optional(),
      fruitId: z.string().optional(),
      drinkId: z.string().optional(),
      mealSize: z.enum(['Small', 'Regular', 'Large']).optional(),
      temperature: z.enum(['Hot', 'Normal']).optional(),
      preferences: z.array(z.string()).optional(),
      notes: z.string().optional().nullable(),
      dietaryRestrictions: z.array(z.string()).optional(),
      allergies: z.array(z.string()).optional(),
    });
    const data = schema.parse(req.body);

    // Update items if meal ids provided
    const mealMap: Record<string, string | undefined> = {
      rice: data.riceId,
      protein: data.proteinId,
      salad: data.saladId,
      fruit: data.fruitId,
      drink: data.drinkId,
    };

    for (const [cat, mealId] of Object.entries(mealMap)) {
      if (mealId) {
        const meal = await prisma.meal.findFirst({
          where: { id: mealId, isActive: true },
          include: { category: true },
        });
        if (!meal || meal.category.slug !== cat) {
          return res.status(400).json({ success: false, message: `Invalid ${cat} selection` });
        }
        await prisma.orderItem.deleteMany({ where: { orderId: order.id, category: cat } });
        await prisma.orderItem.create({
          data: { orderId: order.id, mealId, category: cat },
        });
      }
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        ...(data.mealSize && { mealSize: data.mealSize }),
        ...(data.temperature && { temperature: data.temperature }),
        ...(data.preferences && { preferences: JSON.stringify(data.preferences) }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.dietaryRestrictions && {
          dietaryRestrictions: JSON.stringify(data.dietaryRestrictions),
        }),
        ...(data.allergies && { allergies: JSON.stringify(data.allergies) }),
      },
      include: {
        items: { include: { meal: true } },
        patient: { include: { user: true } },
      },
    });

    await logActivity('Order Updated', req.user!.id, `Order ${order.orderNumber} updated`, req.ip);

    res.json({ success: true, message: 'Order updated', data: formatOrder(updated) });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update order' });
  }
});

// Employee / Manager: list orders with filters
router.get('/', authenticate, authorize('EMPLOYEE', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      status,
      search,
      from,
      to,
      page = '1',
      limit = '20',
    } = req.query as Record<string, string>;

    const where: any = {};
    if (status) where.status = status;
    if (from || to) {
      where.orderDate = {};
      if (from) where.orderDate.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.orderDate.lte = toDate;
      }
    }
    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { patient: { patientId: { contains: search } } },
        { patient: { user: { name: { contains: search } } } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { include: { meal: true } },
          patient: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      success: true,
      data: orders.map(formatOrder),
      meta: { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load orders' });
  }
});

// Get single order
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { meal: true } },
        patient: { include: { user: true } },
      },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Patient can only see own orders
    if (req.user!.role === 'PATIENT') {
      const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
      if (!patient || order.patientId !== patient.id) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    res.json({ success: true, data: formatOrder(order) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load order' });
  }
});

// Update status (Employee / Manager)
router.patch('/:id/status', authenticate, authorize('EMPLOYEE', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      status: z.enum(['New', 'Preparing', 'Ready', 'Delivered', 'Cancelled']),
    });
    const { status } = schema.parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { patient: { include: { user: true } } },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status },
      include: {
        items: { include: { meal: true } },
        patient: { include: { user: true } },
      },
    });

    const statusMessages: Record<string, { en: string; ar: string }> = {
      Preparing: { en: 'Order Preparing', ar: 'جاري تحضير الطلب' },
      Ready: { en: 'Order Ready', ar: 'الطلب جاهز' },
      Delivered: { en: 'Order Delivered', ar: 'تم توصيل الطلب' },
      Cancelled: { en: 'Order Cancelled', ar: 'تم إلغاء الطلب' },
      New: { en: 'Order Received', ar: 'تم استلام الطلب' },
    };

    if (order.patient?.userId && statusMessages[status]) {
      await createNotification(
        order.patient.userId,
        statusMessages[status].en,
        statusMessages[status].ar,
        `Your order ${order.orderNumber} is now: ${status}`,
        `طلبك رقم ${order.orderNumber} أصبح: ${statusMessages[status].ar}`
      );
    }

    await logActivity(
      status === 'Cancelled' ? 'Order Cancelled' : 'Order Updated',
      req.user!.id,
      `Order ${order.orderNumber} status -> ${status}`,
      req.ip
    );

    res.json({ success: true, data: formatOrder(updated) });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

export default router;
