import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate, authorize('MANAGER'));

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        include: { user: { select: { name: true, username: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.activityLog.count(),
    ]);
    res.json({
      success: true,
      data: logs.map((l) => ({
        id: l.id,
        action: l.action,
        details: l.details,
        user: l.user ? { name: l.user.name, username: l.user.username, role: l.user.role } : null,
        createdAt: l.createdAt,
      })),
      meta: { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load activity logs' });
  }
});

export default router;
