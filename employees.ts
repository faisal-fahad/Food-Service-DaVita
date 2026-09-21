import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { hashPassword } from '../utils/auth';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { logActivity } from '../utils/activityLog';

const router = Router();

router.use(authenticate, authorize('MANAGER'));

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      success: true,
      data: employees.map((e) => ({
        id: e.id,
        name: e.user.name,
        username: e.user.username,
        email: e.user.email,
        phone: e.user.phone,
        status: e.user.status,
        permissions: e.permissions ? JSON.parse(e.permissions) : [],
        lastLoginAt: e.user.lastLoginAt,
        preferredLanguage: e.user.preferredLanguage,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load employees' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      username: z.string().min(3),
      password: z.string().min(8),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      permissions: z.array(z.string()).optional().default(['orders', 'kitchen']),
      preferredLanguage: z.enum(['en', 'ar']).optional().default('en'),
    });
    const data = schema.parse(req.body);

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email || null,
        passwordHash,
        role: 'EMPLOYEE',
        name: data.name,
        phone: data.phone || null,
        preferredLanguage: data.preferredLanguage,
        employee: {
          create: {
            permissions: JSON.stringify(data.permissions),
          },
        },
      },
      include: { employee: true },
    });

    await logActivity('User Created', req.user!.id, `Employee ${data.username} created`, req.ip);

    res.status(201).json({
      success: true,
      data: {
        id: user.employee!.id,
        name: user.name,
        username: user.username,
      },
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Username or email already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create employee' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      permissions: z.array(z.string()).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      preferredLanguage: z.enum(['en', 'ar']).optional(),
    });
    const data = schema.parse(req.body);

    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    await prisma.user.update({
      where: { id: employee.userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.status && { status: data.status }),
        ...(data.preferredLanguage && { preferredLanguage: data.preferredLanguage }),
      },
    });

    if (data.permissions) {
      await prisma.employee.update({
        where: { id: employee.id },
        data: { permissions: JSON.stringify(data.permissions) },
      });
    }

    if (data.status === 'disabled') {
      await logActivity('User Disabled', req.user!.id, `Employee ${employee.user.username} disabled`, req.ip);
    }

    res.json({ success: true, message: 'Employee updated' });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    res.status(500).json({ success: false, message: 'Failed to update employee' });
  }
});

export default router;
