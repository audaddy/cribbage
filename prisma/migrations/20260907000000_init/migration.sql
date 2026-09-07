-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "isGuest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "player0Id" TEXT NOT NULL,
    "player1Id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_opponent',
    "phase" TEXT NOT NULL DEFAULT 'awaiting_opponent',
    "pendingMask" INTEGER NOT NULL DEFAULT 0,
    "dealerSeat" INTEGER NOT NULL DEFAULT 0,
    "score0" INTEGER NOT NULL DEFAULT 0,
    "score1" INTEGER NOT NULL DEFAULT 0,
    "handNumber" INTEGER NOT NULL DEFAULT 0,
    "winnerSeat" INTEGER,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMoveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "seat" INTEGER,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "points" INTEGER,
    "detail" TEXT,
    "handNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "gameVersion" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_displayName_idx" ON "User"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "LoginToken_tokenHash_key" ON "LoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginToken_email_idx" ON "LoginToken"("email");

-- CreateIndex
CREATE INDEX "LoginToken_expiresAt_idx" ON "LoginToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Game_inviteCode_key" ON "Game"("inviteCode");

-- CreateIndex
CREATE INDEX "Game_player0Id_status_idx" ON "Game"("player0Id", "status");

-- CreateIndex
CREATE INDEX "Game_player1Id_status_idx" ON "Game"("player1Id", "status");

-- CreateIndex
CREATE INDEX "Game_status_lastMoveAt_idx" ON "Game"("status", "lastMoveAt");

-- CreateIndex
CREATE INDEX "GameEvent_gameId_seq_idx" ON "GameEvent"("gameId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "GameEvent_gameId_seq_key" ON "GameEvent"("gameId", "seq");

-- CreateIndex
CREATE INDEX "Notification_userId_sentAt_idx" ON "Notification"("userId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_gameId_userId_type_gameVersion_key" ON "Notification"("gameId", "userId", "type", "gameVersion");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_player0Id_fkey" FOREIGN KEY ("player0Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

