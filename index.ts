import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import mealsRoutes from './routes/meals';
import ordersRoutes from './routes/orders';
import patientsRoutes from './routes/patients';
import employeesRoutes from './routes/employees';
import notificationsRoutes from './routes/notifications';
import dashboardRoutes from './routes/dashboard';
import reportsRoutes from './routes/reports';
import activityRoutes from './routes/activity';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Food Service DaVita API is running', version: '1.0.0' });
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/meals', mealsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/activity', activityRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🍽️  Food Service DaVita API running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
