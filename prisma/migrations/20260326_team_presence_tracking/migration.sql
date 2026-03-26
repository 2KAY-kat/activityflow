-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
