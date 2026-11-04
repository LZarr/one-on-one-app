-- AlterTable
ALTER TABLE "MeetingRequest" ADD COLUMN     "assignedByAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "message" TEXT;

-- CreateTable
CREATE TABLE "RetreatDayHours" (
    "id" TEXT NOT NULL,
    "retreatId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dayStart" TEXT NOT NULL,
    "dayEnd" TEXT NOT NULL,

    CONSTRAINT "RetreatDayHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetreatDayHours_retreatId_date_key" ON "RetreatDayHours"("retreatId", "date");

-- AddForeignKey
ALTER TABLE "RetreatDayHours" ADD CONSTRAINT "RetreatDayHours_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
