-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "player2Id" TEXT,
ADD COLUMN     "player3Id" TEXT,
ADD COLUMN     "score2" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variant" TEXT NOT NULL DEFAULT 'two';

-- CreateIndex
CREATE INDEX "Game_player2Id_status_idx" ON "Game"("player2Id", "status");

-- CreateIndex
CREATE INDEX "Game_player3Id_status_idx" ON "Game"("player3Id", "status");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_player3Id_fkey" FOREIGN KEY ("player3Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
