import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { logActivity } from '../utils/activityLog';

const router = Router();

// Public for authenticated users - list active meals by category
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.mealCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        meals: {
          where: { isActive: true, isHidden: false },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({
      success: true,
      data: categories.map((c) => ({
        id: c.id,
        slug: c.slug,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        meals: c.meals.map((m) => ({
          id: m.id,
          nameEn: m.nameEn,
          nameAr: m.nameAr,
          imageUrl: m.imageUrl,
        })),
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load meals' });
  }
});

// Manager: full meal management
router.get('/manage', authenticate, authorize('MANAGER'), async (_req, res: Response) => {
  try {
    const categories = await prisma.mealCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        meals: { orderBy: { sortOrder: 'asc' } },
      },
    });
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load meals' });
  }
});

router.post('/', authenticate, authorize('MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      categoryId: z.string(),
      nameEn: z.string().min(1),
      nameAr: z.string().min(1),
      imageUrl: z.string().optional().nullable(),
      sortOrder: z.number().optional(),
    });
    const data = schema.parse(req.body);

    const meal = await prisma.meal.create({
      data: {
        categoryId: data.categoryId,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        imageUrl: data.imageUrl || null,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    await logActivity('Meal Created', req.user!.id, `Created meal ${data.nameEn}`, req.ip);
    res.status(201).json({ success: true, data: meal });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    res.status(500).json({ success: false, message: 'Failed to create meal' });
  }
});

router.put('/:id', authenticate, authorize('MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      nameEn: z.string().min(1).optional(),
      nameAr: z.string().min(1).optional(),
      imageUrl: z.string().optional().nullable(),
      isActive: z.boolean().optional(),
      isHidden: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });
    const data = schema.parse(req.body);

    const meal = await prisma.meal.update({
      where: { id: req.params.id },
      data,
    });

    await logActivity('Meal Updated', req.user!.id, `Updated meal ${meal.nameEn}`, req.ip);
    res.json({ success: true, data: meal });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Meal not found' });
    }
    res.status(500).json({ success: false, message: 'Failed to update meal' });
  }
});

router.delete('/:id', authenticate, authorize('MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.meal.delete({ where: { id: req.params.id } });
    await logActivity('Meal Deleted', req.user!.id, `Deleted meal ${req.params.id}`, req.ip);
    res.json({ success: true, message: 'Meal deleted' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Meal not found' });
    }
    res.status(500).json({ success: false, message: 'Failed to delete meal' });
  }
});

export default router;
