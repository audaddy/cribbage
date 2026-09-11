-- CreateTable
CREATE TABLE "GameHidden" (
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameHidden_pkey" PRIMARY KEY ("gameId","userId")
);

-- CreateIndex
CREATE INDEX "GameHidden_userId_idx" ON "GameHidden"("userId");

-- AddForeignKey
ALTER TABLE "GameHidden" ADD CONSTRAINT "GameHidden_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameHidden" ADD CONSTRAINT "GameHidden_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
