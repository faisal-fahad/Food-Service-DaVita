import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { hashPassword, comparePassword, signToken, validatePasswordStrength } from '../utils/auth';
import { logActivity } from '../utils/activityLog';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', async (req, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: username },
          { email: username },
          { patient: { patientId: username } },
        ],
      },
      include: {
        patient: true,
        employee: true,
      },
    });

    if (!user || user.status !== 'active') {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await logActivity('Login', user.id, `User logged in`, req.ip);

    const token = signToken({
      userId: user.id,
      role: user.role,
      username: user.username,
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone,
          preferredLanguage: user.preferredLanguage,
          patient: user.patient
            ? {
                patientId: user.patient.patientId,
                roomNumber: user.patient.roomNumber,
                bedNumber: user.patient.bedNumber,
                department: user.patient.department,
                dietaryRestrictions: user.patient.dietaryRestrictions
                  ? JSON.parse(user.patient.dietaryRestrictions)
                  : [],
                allergies: user.patient.allergies ? JSON.parse(user.patient.allergies) : [],
              }
            : null,
          employee: user.employee
            ? {
                permissions: user.employee.permissions
                  ? JSON.parse(user.employee.permissions)
                  : [],
              }
            : null,
        },
      },
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  await logActivity('Logout', req.user!.id, 'User logged out', req.ip);
  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { patient: true, employee: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
        preferredLanguage: user.preferredLanguage,
        patient: user.patient
          ? {
              patientId: user.patient.patientId,
              roomNumber: user.patient.roomNumber,
              bedNumber: user.patient.bedNumber,
              department: user.patient.department,
              dietaryRestrictions: user.patient.dietaryRestrictions
                ? JSON.parse(user.patient.dietaryRestrictions)
                : [],
              allergies: user.patient.allergies ? JSON.parse(user.patient.allergies) : [],
            }
          : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

// Setup first manager (only works when no manager exists)
router.post('/setup-manager', async (req, res: Response) => {
  try {
    const existingManager = await prisma.user.findFirst({ where: { role: 'MANAGER' } });
    if (existingManager) {
      return res.status(400).json({
        success: false,
        message: 'Manager already exists. Use environment variables or contact admin.',
      });
    }

    const schema = z.object({
      username: z.string().min(3),
      password: z.string().min(8),
      name: z.string().min(2),
      email: z.string().email().optional(),
    });

    // Prefer body, fallback to env
    const body = req.body || {};
    const username = body.username || process.env.SETUP_MANAGER_USERNAME;
    const password = body.password || process.env.SETUP_MANAGER_PASSWORD;
    const name = body.name || process.env.SETUP_MANAGER_NAME || 'System Manager';
    const email = body.email || process.env.SETUP_MANAGER_EMAIL;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message:
          'Provide username & password in body or set SETUP_MANAGER_USERNAME and SETUP_MANAGER_PASSWORD in .env',
      });
    }

    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return res.status(400).json({ success: false, message: strength.message });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        email: email || null,
        passwordHash,
        role: 'MANAGER',
        name,
        preferredLanguage: 'en',
        status: 'active',
      },
    });

    await logActivity('User Created', user.id, 'First manager account created via setup', req.ip);

    res.status(201).json({
      success: true,
      message: 'Manager account created successfully. You can now login.',
      data: { id: user.id, username: user.username, name: user.name },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Username or email already exists' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Setup failed' });
  }
});

export default router;
