import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { hashPassword } from '../utils/auth';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { logActivity } from '../utils/activityLog';

const router = Router();

router.use(authenticate, authorize('MANAGER', 'EMPLOYEE'));

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { search, status, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: any = {};
    if (status) where.user = { status };
    if (search) {
      where.OR = [
        { patientId: { contains: search } },
        { user: { name: { contains: search } } },
        { roomNumber: { contains: search } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.patient.count({ where }),
    ]);

    res.json({
      success: true,
      data: patients.map((p) => ({
        id: p.id,
        patientId: p.patientId,
        name: p.user.name,
        username: p.user.username,
        email: p.user.email,
        phone: p.user.phone,
        roomNumber: p.roomNumber,
        bedNumber: p.bedNumber,
        department: p.department,
        status: p.user.status,
        dietaryRestrictions: p.dietaryRestrictions ? JSON.parse(p.dietaryRestrictions) : [],
        allergies: p.allergies ? JSON.parse(p.allergies) : [],
        preferredLanguage: p.user.preferredLanguage,
        createdAt: p.createdAt,
      })),
      meta: { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load patients' });
  }
});

router.post('/', authorize('MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      username: z.string().min(3),
      password: z.string().min(8),
      patientId: z.string().min(1),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      roomNumber: z.string().optional().nullable(),
      bedNumber: z.string().optional().nullable(),
      department: z.string().optional().nullable(),
      dietaryRestrictions: z.array(z.string()).optional().default([]),
      allergies: z.array(z.string()).optional().default([]),
      preferredLanguage: z.enum(['en', 'ar']).optional().default('en'),
    });
    const data = schema.parse(req.body);

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email || null,
        passwordHash,
        role: 'PATIENT',
        name: data.name,
        phone: data.phone || null,
        preferredLanguage: data.preferredLanguage,
        patient: {
          create: {
            patientId: data.patientId,
            roomNumber: data.roomNumber || null,
            bedNumber: data.bedNumber || null,
            department: data.department || null,
            dietaryRestrictions: JSON.stringify(data.dietaryRestrictions),
            allergies: JSON.stringify(data.allergies),
          },
        },
      },
      include: { patient: true },
    });

    await logActivity('User Created', req.user!.id, `Patient ${data.patientId} created`, req.ip);

    res.status(201).json({
      success: true,
      data: {
        id: user.patient!.id,
        patientId: user.patient!.patientId,
        name: user.name,
        username: user.username,
      },
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input', errors: err.errors });
    }
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Username, email or Patient ID already exists' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create patient' });
  }
});

router.put('/:id', authorize('MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      roomNumber: z.string().optional().nullable(),
      bedNumber: z.string().optional().nullable(),
      department: z.string().optional().nullable(),
      dietaryRestrictions: z.array(z.string()).optional(),
      allergies: z.array(z.string()).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      preferredLanguage: z.enum(['en', 'ar']).optional(),
    });
    const data = schema.parse(req.body);

    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

    await prisma.user.update({
      where: { id: patient.userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.status && { status: data.status }),
        ...(data.preferredLanguage && { preferredLanguage: data.preferredLanguage }),
      },
    });

    await prisma.patient.update({
      where: { id: patient.id },
      data: {
        ...(data.roomNumber !== undefined && { roomNumber: data.roomNumber }),
        ...(data.bedNumber !== undefined && { bedNumber: data.bedNumber }),
        ...(data.department !== undefined && { department: data.department }),
        ...(data.dietaryRestrictions && {
          dietaryRestrictions: JSON.stringify(data.dietaryRestrictions),
        }),
        ...(data.allergies && { allergies: JSON.stringify(data.allergies) }),
      },
    });

    if (data.status === 'disabled') {
      await logActivity('User Disabled', req.user!.id, `Patient ${patient.patientId} disabled`, req.ip);
    }

    res.json({ success: true, message: 'Patient updated' });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    res.status(500).json({ success: false, message: 'Failed to update patient' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        orders: {
          include: { items: { include: { meal: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

    res.json({
      success: true,
      data: {
        id: patient.id,
        patientId: patient.patientId,
        name: patient.user.name,
        username: patient.user.username,
        email: patient.user.email,
        phone: patient.user.phone,
        roomNumber: patient.roomNumber,
        bedNumber: patient.bedNumber,
        department: patient.department,
        status: patient.user.status,
        dietaryRestrictions: patient.dietaryRestrictions
          ? JSON.parse(patient.dietaryRestrictions)
          : [],
        allergies: patient.allergies ? JSON.parse(patient.allergies) : [],
        orders: patient.orders,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load patient' });
  }
});

router.delete('/:id', authorize('MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

    await prisma.user.delete({ where: { id: patient.userId } });
    await logActivity('User Deleted', req.user!.id, `Patient ${patient.patientId} deleted`, req.ip);
    res.json({ success: true, message: 'Patient deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete patient' });
  }
});

export default router;
