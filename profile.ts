import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { hashPassword, comparePassword, validatePasswordStrength } from '../utils/auth';
import { logActivity } from '../utils/activityLog';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { patient: true, employee: true },
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
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
    res.status(500).json({ success: false, message: 'Failed to load profile' });
  }
});

router.put('/', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).optional(),
      phone: z.string().optional().nullable(),
      email: z.string().email().optional().nullable(),
      preferredLanguage: z.enum(['en', 'ar']).optional(),
    });
    const data = schema.parse(req.body);

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.preferredLanguage && { preferredLanguage: data.preferredLanguage }),
      },
    });

    await logActivity('Profile Updated', req.user!.id, 'Profile information updated', req.ip);

    res.json({
      success: true,
      message: 'Profile updated',
      data: {
        id: updated.id,
        username: updated.username,
        email: updated.email,
        name: updated.name,
        phone: updated.phone,
        preferredLanguage: updated.preferredLanguage,
      },
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input', errors: err.errors });
    }
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

router.put('/password', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
      confirmPassword: z.string().min(8),
    });
    const { currentPassword, newPassword, confirmPassword } = schema.parse(req.body);

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New passwords do not match' });
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return res.status(400).json({ success: false, message: strength.message });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash },
    });

    await logActivity('Password Changed', req.user!.id, 'Password was changed', req.ip);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    res.status(500).json({ success: false, message: 'Password change failed' });
  }
});

router.put('/username', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      newUsername: z.string().min(3).max(50),
      password: z.string().min(1),
    });
    const { newUsername, password } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Password is incorrect' });
    }

    const existing = await prisma.user.findUnique({ where: { username: newUsername } });
    if (existing && existing.id !== user.id) {
      return res.status(400).json({ success: false, message: 'Username already taken' });
    }

    const oldUsername = user.username;
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { username: newUsername },
    });

    await logActivity(
      'Username Changed',
      req.user!.id,
      `Username changed from ${oldUsername} to ${newUsername}`,
      req.ip
    );

    res.json({ success: true, message: 'Username changed successfully', data: { username: newUsername } });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Invalid input' });
    }
    res.status(500).json({ success: false, message: 'Username change failed' });
  }
});

export default router;
