import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Food Service DaVita database...');

  // Categories
  const categories = [
    { slug: 'rice', nameEn: 'Rice', nameAr: 'الأرز', sortOrder: 1 },
    { slug: 'protein', nameEn: 'Protein', nameAr: 'البروتين', sortOrder: 2 },
    { slug: 'salad', nameEn: 'Salad', nameAr: 'السلطات', sortOrder: 3 },
    { slug: 'fruit', nameEn: 'Fruit', nameAr: 'الفواكه', sortOrder: 4 },
    { slug: 'drink', nameEn: 'Drink', nameAr: 'المشروبات', sortOrder: 5 },
  ];

  for (const cat of categories) {
    await prisma.mealCategory.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }

  const rice = await prisma.mealCategory.findUnique({ where: { slug: 'rice' } });
  const protein = await prisma.mealCategory.findUnique({ where: { slug: 'protein' } });
  const salad = await prisma.mealCategory.findUnique({ where: { slug: 'salad' } });
  const fruit = await prisma.mealCategory.findUnique({ where: { slug: 'fruit' } });
  const drink = await prisma.mealCategory.findUnique({ where: { slug: 'drink' } });

  const meals = [
    { categoryId: rice!.id, nameEn: 'White Rice', nameAr: 'رز أبيض', sortOrder: 1 },
    { categoryId: rice!.id, nameEn: 'Spanish Rice', nameAr: 'رز إسباني', sortOrder: 2 },
    { categoryId: rice!.id, nameEn: 'Mandi Rice', nameAr: 'رز مندي', sortOrder: 3 },
    { categoryId: protein!.id, nameEn: 'Chicken Kebab', nameAr: 'كباب دجاج', sortOrder: 1 },
    { categoryId: protein!.id, nameEn: 'Shish Tawook', nameAr: 'شيش طاووق', sortOrder: 2 },
    { categoryId: protein!.id, nameEn: 'Fajita', nameAr: 'فاهيتا', sortOrder: 3 },
    { categoryId: salad!.id, nameEn: 'Fattoush', nameAr: 'فتوش', sortOrder: 1 },
    { categoryId: salad!.id, nameEn: 'Tabbouleh', nameAr: 'تبولة', sortOrder: 2 },
    { categoryId: salad!.id, nameEn: 'Caesar Salad', nameAr: 'سلطة سيزر', sortOrder: 3 },
    { categoryId: fruit!.id, nameEn: 'Apple', nameAr: 'تفاح', sortOrder: 1 },
    { categoryId: fruit!.id, nameEn: 'Grapes', nameAr: 'عنب', sortOrder: 2 },
    { categoryId: fruit!.id, nameEn: 'Watermelon', nameAr: 'بطيخ', sortOrder: 3 },
    { categoryId: fruit!.id, nameEn: 'Pineapple', nameAr: 'أناناس', sortOrder: 4 },
    { categoryId: drink!.id, nameEn: 'Apple Juice', nameAr: 'عصير تفاح', sortOrder: 1 },
    { categoryId: drink!.id, nameEn: 'Pineapple Juice', nameAr: 'عصير أناناس', sortOrder: 2 },
    { categoryId: drink!.id, nameEn: 'Lemon Mint', nameAr: 'ليمون نعناع', sortOrder: 3 },
    { categoryId: drink!.id, nameEn: 'Tea', nameAr: 'شاي', sortOrder: 4 },
  ];

  for (const m of meals) {
    const existing = await prisma.meal.findFirst({
      where: { nameEn: m.nameEn, categoryId: m.categoryId },
    });
    if (!existing) {
      await prisma.meal.create({ data: m });
    }
  }

  // Demo Patient (password: Patient@123)
  const patientPass = await bcrypt.hash('Patient@123', 12);
  const existingPatient = await prisma.user.findUnique({ where: { username: 'patient1' } });
  if (!existingPatient) {
    await prisma.user.create({
      data: {
        username: 'patient1',
        email: 'patient1@davita.local',
        passwordHash: patientPass,
        role: 'PATIENT',
        name: 'Ahmed Al-Rashid',
        phone: '+966500000001',
        preferredLanguage: 'ar',
        patient: {
          create: {
            patientId: 'P-10001',
            roomNumber: '301',
            bedNumber: 'A',
            department: 'Internal Medicine',
            dietaryRestrictions: JSON.stringify(['Low Salt']),
            allergies: JSON.stringify(['Nuts']),
          },
        },
      },
    });
    console.log('  ✓ Demo patient: patient1 / Patient@123 (Patient ID: P-10001)');
  }

  // Demo Employee (password: Employee@123)
  const empPass = await bcrypt.hash('Employee@123', 12);
  const existingEmp = await prisma.user.findUnique({ where: { username: 'employee1' } });
  if (!existingEmp) {
    await prisma.user.create({
      data: {
        username: 'employee1',
        email: 'employee1@davita.local',
        passwordHash: empPass,
        role: 'EMPLOYEE',
        name: 'Sara Kitchen',
        phone: '+966500000002',
        preferredLanguage: 'en',
        employee: {
          create: {
            permissions: JSON.stringify(['orders', 'kitchen']),
          },
        },
      },
    });
    console.log('  ✓ Demo employee: employee1 / Employee@123');
  }

  console.log('');
  console.log('✅ Seed completed.');
  console.log('');
  console.log('⚠️  Manager account is NOT created by seed.');
  console.log('   Create it securely via:');
  console.log('   POST /api/auth/setup-manager');
  console.log('   or set SETUP_MANAGER_* in .env and call the endpoint once.');
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
