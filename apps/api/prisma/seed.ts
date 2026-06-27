import { PrismaClient, UserRole, TemplateVisibility } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not defined in the environment.');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Standard Free Fire point table (top-12 placement scoring) */
const FF_POINT_TABLE: Record<string, number> = {
  '1': 12,
  '2': 9,
  '3': 8,
  '4': 7,
  '5': 6,
  '6': 5,
  '7': 4,
  '8': 3,
  '9': 2,
  '10': 1,
  '11': 0,
  '12': 0,
};

async function main() {
  console.log('🌱 Seeding mock data...');

  // ── 1. Organization ────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { id: 'mock-org-id' },
    update: {},
    create: {
      id: 'mock-org-id',
      name: 'Mock Organization',
      slug: 'mock-org',
      plan: 'FREE',
    },
  });
  console.log(`✅ Organization: ${org.name} (${org.id})`);

  // ── 2. Super Admin User ────────────────────────────────────────────────────
  const user = await prisma.user.upsert({
    where: { email: 'admin@tournamentos.com' },
    update: {},
    create: {
      id: 'mock-admin-id',
      email: 'admin@tournamentos.com',
      name: 'Mock Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId: org.id,
    },
  });
  console.log(`✅ Admin User: ${user.name} (${user.role})`);

  // ── 3. Fix 2: System Tournament Templates ──────────────────────────────────

  // Template: Free Fire Standard (3 stages: Qualifier → Semi → Final)
  await prisma.tournamentTemplate.upsert({
    where: { id: 'tpl-ff-standard' },
    update: {},
    create: {
      id: 'tpl-ff-standard',
      name: 'Free Fire Standard (240-Team)',
      game: 'Free Fire',
      organizationId: null, // global/system template
      visibility: TemplateVisibility.SYSTEM,
      stageBlueprint: [
        {
          name: 'Qualifier',
          order: 1,
          roundCount: 1,
          roomCapacity: 20,
          qualificationRule: { type: 'TOP_X_PER_ROOM', x: 3 },
        },
        {
          name: 'Semi-Final',
          order: 2,
          roundCount: 1,
          roomCapacity: 20,
          qualificationRule: { type: 'TOP_X_PER_ROOM', x: 3 },
        },
        {
          name: 'Grand Final',
          order: 3,
          roundCount: 1,
          roomCapacity: 20,
          qualificationRule: null,
        },
      ],
    },
  });

  // Template: Free Fire Compact (2 stages for smaller events ≤ 60 teams)
  await prisma.tournamentTemplate.upsert({
    where: { id: 'tpl-ff-compact' },
    update: {},
    create: {
      id: 'tpl-ff-compact',
      name: 'Free Fire Compact (60-Team)',
      game: 'Free Fire',
      organizationId: null,
      visibility: TemplateVisibility.SYSTEM,
      stageBlueprint: [
        {
          name: 'Qualifier',
          order: 1,
          roundCount: 1,
          roomCapacity: 20,
          qualificationRule: { type: 'TOP_X_PER_ROOM', x: 5 },
        },
        {
          name: 'Grand Final',
          order: 2,
          roundCount: 1,
          roomCapacity: 20,
          qualificationRule: null,
        },
      ],
    },
  });

  console.log(`✅ Tournament Templates seeded (2 system templates)`);

  // ── 4. Sample Tournament with JSONB config ─────────────────────────────────
  const tournament = await prisma.tournament.upsert({
    where: { id: 'mock-tournament-id' },
    update: {},
    create: {
      id: 'mock-tournament-id',
      organizationId: org.id,
      name: 'Free Fire Pro League S1',
      game: 'Free Fire',
      status: 'DRAFT',
      startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks out
      rules:
        'Standard Free Fire Battle Royale rules. Top 3 teams per lobby qualify. Kill + placement points.',
      config: {
        maxTeams: 240,
        roomCapacity: 20,
        qualificationType: 'TOP_X_PER_ROOM',
        pointTable: FF_POINT_TABLE,
        killPoints: 1,
        tiebreaker: 'kills',
      },
      registrationStartsAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // opened 1 day ago
      registrationEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // closes in 7 days
      createdBy: user.id,
    },
  });
  console.log(`✅ Sample Tournament: ${tournament.name} (${tournament.id})`);

  console.log('\n🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
