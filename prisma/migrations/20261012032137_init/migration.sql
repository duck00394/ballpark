-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'POSTPONED', 'CANCELLED', 'SUSPENDED', 'OTHER');

-- CreateEnum
CREATE TYPE "GameSource" AS ENUM ('MANUAL', 'CPBL', 'IMPORT');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PLANNED', 'ATTENDED', 'ABSENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'BUYING', 'PURCHASED', 'FAILED', 'CANCELLED', 'REFUNDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FeeSplitMode" AS ENUM ('BUYER_ABSORBS', 'EQUAL_HOLDERS', 'PER_TICKET', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'DELIVERED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('NOT_PICKED', 'PICKED', 'FAILED', 'REFUNDED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('TICKET', 'FEE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('VALID', 'REVOKED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('PLATFORM', 'MEMBER');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "favoriteTeamId" TEXT,
    "followedTeamIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trackOtherTeams" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeGroupId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "league" TEXT NOT NULL DEFAULT 'CPBL',
    "code" TEXT,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceName" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "externalKey" TEXT,
    "source" "GameSource" NOT NULL DEFAULT 'MANUAL',
    "league" TEXT NOT NULL DEFAULT 'CPBL',
    "season" INTEGER NOT NULL,
    "kindCode" TEXT,
    "gameType" TEXT NOT NULL DEFAULT '例行賽',
    "gameNumber" INTEGER,
    "name" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "venueId" TEXT,
    "status" "GameStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "resultConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "reserveDate" TIMESTAMP(3),
    "manualLock" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameChange" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAttendance" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supportTeamId" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSyncLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "success" BOOLEAN NOT NULL DEFAULT false,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "triggeredBy" TEXT,

    CONSTRAINT "ScheduleSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketPlatform" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "webUrl" TEXT,
    "appUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketPlatform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketOrder" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "platformId" TEXT,
    "purchaseUrl" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "buyerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "orderNumber" TEXT,
    "ticketCategory" TEXT,
    "feeAmount" INTEGER NOT NULL DEFAULT 0,
    "otherFeeAmount" INTEGER NOT NULL DEFAULT 0,
    "actualTotal" INTEGER,
    "feeSplitMode" "FeeSplitMode" NOT NULL DEFAULT 'PER_TICKET',
    "customFeeSplit" JSONB,
    "status" "OrderStatus" NOT NULL DEFAULT 'PURCHASED',
    "pickupDeadline" TIMESTAMP(3),
    "note" TEXT,
    "clientRequestId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "holderId" TEXT,
    "price" INTEGER NOT NULL,
    "section" TEXT,
    "rowLabel" TEXT,
    "seatNumber" TEXT,
    "ticketType" TEXT NOT NULL DEFAULT '電子票',
    "pickupMethod" TEXT,
    "secretInfo" TEXT,
    "transferStatus" "TransferStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "pickupStatus" "PickupStatus" NOT NULL DEFAULT 'NOT_PICKED',
    "receivedConfirmedAt" TIMESTAMP(3),
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTransfer" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketId" TEXT,
    "debtorId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "orderId" TEXT,
    "settlementId" TEXT,
    "amount" INTEGER NOT NULL,
    "method" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PaymentStatus" NOT NULL DEFAULT 'VALID',
    "payerConfirmedAt" TIMESTAMP(3),
    "payeeConfirmedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "kind" "RefundKind" NOT NULL,
    "orderId" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PROCESSING',
    "method" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "netAmount" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'COMPLETED',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementItem" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "SettlementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_league_code_key" ON "Team"("league", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Team_league_name_key" ON "Team"("league", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_name_key" ON "Venue"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_sourceName_key" ON "Venue"("sourceName");

-- CreateIndex
CREATE UNIQUE INDEX "Game_externalKey_key" ON "Game"("externalKey");

-- CreateIndex
CREATE INDEX "Game_startAt_idx" ON "Game"("startAt");

-- CreateIndex
CREATE INDEX "Game_groupId_idx" ON "Game"("groupId");

-- CreateIndex
CREATE INDEX "Game_season_kindCode_idx" ON "Game"("season", "kindCode");

-- CreateIndex
CREATE INDEX "GameChange_gameId_createdAt_idx" ON "GameChange"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "GameAttendance_userId_idx" ON "GameAttendance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameAttendance_groupId_gameId_userId_key" ON "GameAttendance"("groupId", "gameId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketPlatform_groupId_name_key" ON "TicketPlatform"("groupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TicketOrder_clientRequestId_key" ON "TicketOrder"("clientRequestId");

-- CreateIndex
CREATE INDEX "TicketOrder_groupId_gameId_idx" ON "TicketOrder"("groupId", "gameId");

-- CreateIndex
CREATE INDEX "Ticket_groupId_holderId_idx" ON "Ticket"("groupId", "holderId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_orderId_seq_key" ON "Ticket"("orderId", "seq");

-- CreateIndex
CREATE INDEX "TicketTransfer_ticketId_idx" ON "TicketTransfer"("ticketId");

-- CreateIndex
CREATE INDEX "Obligation_groupId_debtorId_creditorId_active_idx" ON "Obligation"("groupId", "debtorId", "creditorId", "active");

-- CreateIndex
CREATE INDEX "Obligation_orderId_active_idx" ON "Obligation"("orderId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_settlementId_key" ON "Payment"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_clientRequestId_key" ON "Payment"("clientRequestId");

-- CreateIndex
CREATE INDEX "Payment_groupId_payerId_payeeId_idx" ON "Payment"("groupId", "payerId", "payeeId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_clientRequestId_key" ON "Refund"("clientRequestId");

-- CreateIndex
CREATE INDEX "Refund_groupId_idx" ON "Refund"("groupId");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_clientRequestId_key" ON "Settlement"("clientRequestId");

-- CreateIndex
CREATE INDEX "Settlement_groupId_idx" ON "Settlement"("groupId");

-- CreateIndex
CREATE INDEX "SettlementItem_orderId_idx" ON "SettlementItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_groupId_name_key" ON "PaymentMethod"("groupId", "name");

-- CreateIndex
CREATE INDEX "AuditLog_groupId_createdAt_idx" ON "AuditLog"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_favoriteTeamId_fkey" FOREIGN KEY ("favoriteTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameChange" ADD CONSTRAINT "GameChange_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAttendance" ADD CONSTRAINT "GameAttendance_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAttendance" ADD CONSTRAINT "GameAttendance_supportTeamId_fkey" FOREIGN KEY ("supportTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "TicketPlatform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
